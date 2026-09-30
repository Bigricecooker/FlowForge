/**
 * M6 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 故意摆一个杂乱的图 → 点「整理布局」→ 校验分层、对齐、不重叠、间距，
 * 再校验整次布局只算一步撤销、且撤销不会把视口跳回去。
 * 位置断言一律用世界坐标（节点 wrapper 的 transform）而不是屏幕坐标，
 * 这样 fitView 改变缩放平移不会污染结论。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5183;
const CDP_PORT = 9222;
const OUT_DIR = join(process.cwd(), '.verify');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const target = urlPath === '/' ? '/index.html' : urlPath;
  try {
    const body = await readFile(join(DIST, normalize(target)));
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(await readFile(join(DIST, 'index.html')));
  }
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有找到可用的页面目标');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const warnings = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type !== 'log') {
    warnings.push(
      `${message.params.type}: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`,
    );
  }
  if (message.method === 'Runtime.exceptionThrown') {
    warnings.push(`exception: ${message.params.exceptionDetails.exception?.description ?? '?'}`);
  }
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) =>
      message.error
        ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        : resolve(message.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

const asJson = async (expression) => {
  const raw = await evaluate(expression);
  return raw === 'null' ? null : JSON.parse(raw);
};

async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'mouse',
  });
}

async function drag(from, to) {
  await mouse('mousePressed', from.x, from.y);
  for (let i = 1; i <= 20; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / 20,
      from.y + ((to.y - from.y) * i) / 20,
    );
    await sleep(10);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(200);
}

async function key(name, modifiers = 0) {
  const base = {
    key: name,
    code: `Key${name.toUpperCase()}`,
    windowsVirtualKeyCode: 90,
    modifiers,
  };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(250);
}

const report = [];
const record = (label, ok, detail) => {
  report.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
};

/** 世界坐标 + 世界尺寸（节点 inline style 上就是我们写死的 shapeDefs 尺寸）。 */
const geometry = () =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    return JSON.stringify(nodes.map((el) => {
      const match = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(el.style.transform);
      return {
        id: el.getAttribute('data-id'),
        label: el.textContent.trim(),
        x: match ? Number(match[1]) : null,
        y: match ? Number(match[2]) : null,
        w: Number.parseFloat(el.style.width),
        h: Number.parseFloat(el.style.height),
      };
    }));
  })()`);

const viewport = () => evaluate(`document.querySelector('.react-flow__viewport').style.transform`);

const overlaps = (list) => {
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (hit) pairs.push(`${a.label}×${b.label}`);
    }
  }
  return pairs;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1300);
await mkdir(OUT_DIR, { recursive: true });

const emptyDisabled = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局');
  return btn ? String(btn.disabled) : 'not-found';
})()`);
record('画布为空时按钮禁用', emptyDisabled === 'true', `button.disabled = ${emptyDisabled}`);

const layout = await asJson(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
    canvas: { left: flow.left, top: flow.top },
  });
})()`);

// 故意摆乱：A 在下方、B 在左上、C 在右中、D 在中间
const spots = {
  处理: { x: layout.canvas.left + 480, y: layout.canvas.top + 400 },
  判断: { x: layout.canvas.left + 160, y: layout.canvas.top + 110 },
  输入输出: { x: layout.canvas.left + 700, y: layout.canvas.top + 200 },
  起止: { x: layout.canvas.left + 320, y: layout.canvas.top + 300 },
};
await drag(layout.items[0], spots.处理);
await drag(layout.items[2], spots.判断);
await drag(layout.items[3], spots.输入输出);
await drag(layout.items[4], spots.起止);

const handleAt = (index, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const r = nodes[${index}].querySelector('.react-flow__handle-${side}').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

// A(0) → B(1)、A(0) → C(2)、C(2) → D(3)
await drag(await handleAt(0, 'right'), await handleAt(1, 'left'));
await drag(await handleAt(0, 'bottom'), await handleAt(2, 'top'));
await drag(await handleAt(2, 'right'), await handleAt(3, 'left'));

const before = await geometry();
const beforeEdges = await evaluate(`document.querySelectorAll('.react-flow__edge').length`);
record(
  '前置：4 个节点 3 条连线',
  before.length === 4 && beforeEdges === 3,
  `节点 ${before.length}，连线 ${beforeEdges}`,
);
record('布局前节点互不规整', overlaps(before).length === 0, `重叠对数 ${overlaps(before).length}`);

// 节点上显示的是 shapeDefs 的 defaultText，不是图形库的显示名
const LABEL = { A: '处理', B: '条件？', C: '输入输出', D: '开始' };
const labels = before.map((node) => node.label).sort();
record(
  '四个节点标签符合预期',
  JSON.stringify(labels) === JSON.stringify(Object.values(LABEL).sort()),
  `实际 ${JSON.stringify(labels)}`,
);

const beforeViewport = await viewport();

await evaluate(`(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局').click();
  return 'ok';
})()`);
await sleep(700); // 等 fitView 的 300ms 动画结束

const after = await geometry();
const afterViewport = await viewport();
const byLabel = Object.fromEntries(after.map((node) => [node.label, node]));
const A = byLabel[LABEL.A];
const B = byLabel[LABEL.B];
const C = byLabel[LABEL.C];
const D = byLabel[LABEL.D];

record(
  '分层正确（竖向自上而下：处理 → 条件？/输入输出 → 开始）',
  A.y < B.y && A.y < C.y && B.y < D.y && C.y < D.y,
  `y：处理 ${A.y} / 条件？ ${B.y} / 输入输出 ${C.y} / 开始 ${D.y}`,
);

// dagre 按节点「中心」对齐同一 rank；两个节点高度不同，所以左上角 y 本就不相等
const centerY = (node) => node.y + node.h / 2;
record(
  '同层节点中心对齐（条件？与输入输出同一 rank）',
  Math.abs(centerY(B) - centerY(C)) <= 1,
  `中心 y ${centerY(B)} vs ${centerY(C)}，差 ${Math.abs(centerY(B) - centerY(C)).toFixed(2)}px（高度 ${B.h} / ${C.h} 不同，左上角 y 相差一半高度差）`,
);

const overlapPairs = overlaps(after);
record(
  '布局后无节点重叠',
  overlapPairs.length === 0,
  overlapPairs.length ? overlapPairs.join('、') : '无重叠',
);

const siblingGap = Math.abs(B.x + B.w / 2 - (C.x + C.w / 2));
const rankGap = B.y - (A.y + A.h);
record(
  '间距符合 nodesep / ranksep 设定',
  siblingGap >= 60 - 1 && rankGap >= 80 - 1,
  `同层中心距 ${siblingGap.toFixed(1)}px（≥60），层间净距 ${rankGap.toFixed(1)}px（≥80）`,
);

record(
  '布局后 fitView 生效（视口有变化）',
  afterViewport !== beforeViewport,
  `${beforeViewport} → ${afterViewport}`,
);

const bounds = await asJson(`(() => {
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  const nodes = [...document.querySelectorAll('.react-flow__node')].map((el) => el.getBoundingClientRect());
  return JSON.stringify({
    allInside: nodes.every((r) => r.left >= flow.left - 1 && r.right <= flow.right + 1 && r.top >= flow.top - 1 && r.bottom <= flow.bottom + 1),
    count: nodes.length,
  });
})()`);
record('布局后所有节点都在可视区域内', bounds.allInside, `节点数 ${bounds.count}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm6.png'), Buffer.from(shot.data, 'base64'));

// 整次布局 = 一步撤销
await key('z', 2);
const undone = await geometry();
const undoneViewport = await viewport();
const samePositions =
  undone.length === before.length &&
  before.every((node) => {
    const now = undone.find((n) => n.id === node.id);
    return now && now.x === node.x && now.y === node.y;
  });
record(
  '一次 Ctrl+Z 还原全部节点位置（整次布局算一步）',
  samePositions,
  `还原后位置与布局前完全一致：${samePositions}`,
);
record(
  '撤销不改变视口（文档与视口分离）',
  undoneViewport === afterViewport,
  `视口保持 ${undoneViewport === afterViewport}`,
);

record(
  '运行期无控制台警告 / 异常',
  warnings.length === 0,
  warnings.length === 0 ? '无' : warnings.join(' | '),
);

const failed = report.filter((row) => !row.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);

ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
