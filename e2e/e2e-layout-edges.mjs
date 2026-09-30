/**
 * 复现与回归：整理布局后连线是否穿过节点。
 *
 * 用「锚点方位与布局后的相对位置不匹配」的连法复现问题：
 *   处理.底 → 步骤A.顶          （方位一致，预期正常）
 *   步骤A.底 → 步骤B.底          （布局后 B 在 A 正下方 → 线要够到 B 的底边，只能穿过 B）
 *   步骤B.右 → 步骤C.顶
 *
 * 判据：把每条连线按长度采样成点，落在「节点矩形内缩 3px」的区域里即算穿过；
 * 连线两端各 8px 内的采样点不算（那是合法端点）。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5185;
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
  await mouse('mouseMoved', from.x, from.y);
  await sleep(20);
  for (let i = 1; i <= 18; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / 18,
      from.y + ((to.y - from.y) * i) / 18,
    );
    await sleep(10);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(200);
}

const report = [];
const record = (label, ok, detail) => {
  report.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
};

const layout = () =>
  asJson(`(() => {
    const items = [...document.querySelectorAll('ul > li')];
    const flow = document.querySelector('.react-flow').getBoundingClientRect();
    return JSON.stringify({
      items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
      canvas: { left: flow.left, top: flow.top },
    });
  })()`);

const handleAt = (index, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const r = nodes[${index}].querySelector('.react-flow__handle-${side}').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

/** 世界坐标几何 + 连线穿节点检测。 */
const audit = () =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((el, index) => {
      const match = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(el.style.transform);
      return {
        index,
        label: el.textContent.trim(),
        x: Number(match[1]),
        y: Number(match[2]),
        w: Number.parseFloat(el.style.width),
        h: Number.parseFloat(el.style.height),
      };
    });

    const INSET = 3;
    const ENDPOINT_SKIP = 8;
    const crossings = [];
    const edges = [...document.querySelectorAll('.react-flow__edge-path')].map((path, index) => {
      const total = path.getTotalLength();
      const steps = 120;
      let hits = 0;
      const hitNodes = new Set();
      for (let i = 0; i <= steps; i += 1) {
        const travelled = (total * i) / steps;
        if (travelled < ENDPOINT_SKIP || total - travelled < ENDPOINT_SKIP) continue;
        const point = path.getPointAtLength(travelled);
        for (const node of nodes) {
          const inside =
            point.x > node.x + INSET &&
            point.x < node.x + node.w - INSET &&
            point.y > node.y + INSET &&
            point.y < node.y + node.h - INSET;
          if (inside) { hits += 1; hitNodes.add(node.label + '#' + node.index); }
        }
      }
      if (hits > 0) crossings.push({ edge: index, hits, nodes: [...hitNodes] });
      return { index, total: Math.round(total) };
    });

    const overlaps = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlaps.push(a.label + '×' + b.label);
        }
      }
    }

    return JSON.stringify({ nodes, edges, crossings, overlaps });
  })()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1300);
await mkdir(OUT_DIR, { recursive: true });

const grid = await layout();

// 随手摆一个和截图里类似的图：处理在上、三个圆角矩形散在下面
const spots = [
  { x: grid.canvas.left + 330, y: grid.canvas.top + 80 },
  { x: grid.canvas.left + 140, y: grid.canvas.top + 210 },
  { x: grid.canvas.left + 470, y: grid.canvas.top + 300 },
  { x: grid.canvas.left + 300, y: grid.canvas.top + 430 },
];
await drag(grid.items[0], spots[0]); // 处理
await drag(grid.items[1], spots[1]); // 步骤 A
await drag(grid.items[1], spots[2]); // 步骤 B
await drag(grid.items[1], spots[3]); // 步骤 C

// 按"方位与布局后不一致"的方式连线，用来复现问题
await drag(await handleAt(0, 'bottom'), await handleAt(1, 'top'));
await drag(await handleAt(1, 'bottom'), await handleAt(2, 'bottom'));
await drag(await handleAt(2, 'right'), await handleAt(3, 'top'));

const before = await audit();
record(
  '前置：4 节点 3 连线',
  before.nodes.length === 4 && before.edges.length === 3,
  `节点 ${before.nodes.length}，连线 ${before.edges.length}`,
);

await evaluate(`(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局').click();
  return 'ok';
})()`);
await sleep(700);

const after = await audit();
record(
  '布局后节点之间不重叠',
  after.overlaps.length === 0,
  after.overlaps.length ? after.overlaps.join('、') : '无重叠',
);
record(
  '布局后连线不穿过任何节点',
  after.crossings.length === 0,
  after.crossings.length
    ? after.crossings
        .map((c) => `第 ${c.edge + 1} 条线有 ${c.hits} 个采样点落在 ${c.nodes.join('/')} 内部`)
        .join('；')
    : '无穿越',
);

console.log('\n布局后节点世界坐标：');
for (const node of after.nodes) {
  console.log(`  ${node.label} (${node.index})  x=${node.x} y=${node.y} w=${node.w} h=${node.h}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm8-layout-edges.png'), Buffer.from(shot.data, 'base64'));

// ---------------- 场景 2：分叉（一源两目标，再汇到下一层） ----------------
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1300);
const grid2 = await layout();
const fanSpots = [
  { x: grid2.canvas.left + 330, y: grid2.canvas.top + 70 }, // 处理
  { x: grid2.canvas.left + 130, y: grid2.canvas.top + 250 }, // 判断
  { x: grid2.canvas.left + 530, y: grid2.canvas.top + 250 }, // 输入/输出
  { x: grid2.canvas.left + 330, y: grid2.canvas.top + 430 }, // 起止
];
await drag(grid2.items[0], fanSpots[0]);
await drag(grid2.items[2], fanSpots[1]);
await drag(grid2.items[3], fanSpots[2]);
await drag(grid2.items[4], fanSpots[3]);

// 同样按"方位与布局后不一致"的方式连：右→左、底→底、右→左
await drag(await handleAt(0, 'right'), await handleAt(1, 'left'));
await drag(await handleAt(0, 'bottom'), await handleAt(2, 'bottom'));
await drag(await handleAt(2, 'right'), await handleAt(3, 'left'));

await evaluate(`(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局').click();
  return 'ok';
})()`);
await sleep(700);

const fan = await audit();
record(
  '[分叉场景] 布局后节点之间不重叠',
  fan.overlaps.length === 0,
  fan.overlaps.length ? fan.overlaps.join('、') : '无重叠',
);
record(
  '[分叉场景] 布局后连线不穿过任何节点',
  fan.crossings.length === 0,
  fan.crossings.length
    ? fan.crossings
        .map((c) => `第 ${c.edge + 1} 条线有 ${c.hits} 个采样点落在 ${c.nodes.join('/')} 内部`)
        .join('；')
    : '无穿越',
);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm8-layout-fan.png'), Buffer.from(shot2.data, 'base64'));

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
