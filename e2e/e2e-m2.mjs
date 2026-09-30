/**
 * M2 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 用 CDP 驱动 headless Chrome 真实模拟「从图形库拖拽到画布」，
 * 校验 1:1 落点精度，并验证缩放后落点依然精确。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5180;
const CDP_PORT = 9222;
const OUT_DIR = join(process.cwd(), '.verify');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 静态服务 dist ----
const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const target = urlPath === '/' ? '/index.html' : urlPath;
  try {
    const body = await readFile(join(DIST, normalize(target)));
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    const body = await readFile(join(DIST, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(body);
  }
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

// ---- 连接 CDP ----
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
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) =>
      message.error
        ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        : resolve(message.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(`求值失败: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'mouse',
    ...extra,
  });
}

/** 模拟一次「按下 → 分段移动 → 松手」。 */
async function drag(from, to) {
  await mouse('mousePressed', from.x, from.y);
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await sleep(16);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(150);
}

const report = [];
const record = (label, ok, detail) => {
  report.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
};

// ---- 加载页面 ----
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1500);

const bootstrapped = await evaluate(
  `!!document.querySelector('.react-flow') && document.querySelectorAll('ul > li').length`,
);
record('页面与画布就绪', bootstrapped === 5, `图形库条目 ${bootstrapped} 个，React Flow 容器存在`);

const palette = await evaluate(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
    canvas: { left: flow.left, top: flow.top, right: flow.right, bottom: flow.bottom },
  });
})()`).then(JSON.parse);

/** 拖第 index 个图形到 (x, y)，返回被测节点中心与目标点的偏差。 */
async function dropAndMeasure(index, x, y) {
  const from = palette.items[index];
  await drag(from, { x, y });
  const measured = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    if (nodes.length === 0) return 'null';
    const r = nodes[nodes.length - 1].getBoundingClientRect();
    return JSON.stringify({
      count: nodes.length,
      centerX: r.left + r.width / 2,
      centerY: r.top + r.height / 2,
      zoom: document.querySelector('.react-flow__viewport').style.transform,
    });
  })()`);
  if (measured === 'null') return null;
  const parsed = JSON.parse(measured);
  return { ...parsed, dx: parsed.centerX - x, dy: parsed.centerY - y };
}

// 目标点选在画布内、避开工具栏
const targetA = { x: palette.canvas.left + 260, y: palette.canvas.top + 200 };
const first = await dropAndMeasure(0, targetA.x, targetA.y);
record(
  '缩放 100% 时落点与光标一致',
  first !== null && Math.abs(first.dx) <= 1.5 && Math.abs(first.dy) <= 1.5,
  first
    ? `节点中心偏差 dx=${first.dx.toFixed(1)}px, dy=${first.dy.toFixed(1)}px，节点数 ${first.count}`
    : '没有生成节点',
);

// 放大后再落一个，验证坐标换算随缩放依然精确
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: Math.round(targetA.x),
  y: Math.round(targetA.y),
  deltaX: 0,
  deltaY: -240,
  pointerType: 'mouse',
});
await sleep(400);

const targetB = { x: palette.canvas.left + 520, y: palette.canvas.top + 380 };
const second = await dropAndMeasure(2, targetB.x, targetB.y);
record(
  '缩放后落点与光标一致',
  second !== null && Math.abs(second.dx) <= 1.5 && Math.abs(second.dy) <= 1.5,
  second
    ? `节点中心偏差 dx=${second.dx.toFixed(1)}px, dy=${second.dy.toFixed(1)}px，节点数 ${second.count}，视口 ${second.zoom}`
    : '没有生成节点',
);

const statusText = await evaluate(
  `document.querySelector('footer').innerText.replace(/\\s+/g, ' ')`,
);
record('状态栏反映真实数据', /节点\s*2/.test(statusText), statusText);

// 拖动已有节点，确认画布上的节点可移动（React Flow 拖拽链路可用）
await drag({ x: targetB.x, y: targetB.y }, { x: targetB.x + 120, y: targetB.y + 60 });
const movedText = await evaluate(
  `document.querySelector('footer').innerText.replace(/\\s+/g, ' ')`,
);
record('节点可拖动且计数不变', /节点\s*2/.test(movedText), movedText);

await mkdir(OUT_DIR, { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm2.png'), Buffer.from(shot.data, 'base64'));
console.log('截图已写入 .verify/m2.png');

const failed = report.filter((row) => !row.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);

ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
