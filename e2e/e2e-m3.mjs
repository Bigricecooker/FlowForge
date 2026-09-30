/**
 * M3 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 落两个节点 → 真实拖拽锚点连线 → 校验连线数、箭头、主题取色 → 切换三种边型 → 端点吸附。
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
const consoleWarnings = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
    consoleWarnings.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
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
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await sleep(12);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(200);
}

const report = [];
const record = (label, ok, detail) => {
  report.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
};

const EDGE_STROKE = 'rgb(148, 163, 184)'; // --edge #94a3b8

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1500);

const layout = await asJson(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
    canvas: { left: flow.left, top: flow.top, right: flow.right, bottom: flow.bottom },
  });
})()`);

const spotA = { x: layout.canvas.left + 220, y: layout.canvas.top + 160 };
const spotB = { x: layout.canvas.left + 520, y: layout.canvas.top + 330 };
await drag(layout.items[0], spotA);
await drag(layout.items[2], spotB);

const dropped = await evaluate(`document.querySelectorAll('.react-flow__node').length`);
record('两个节点已落图', dropped === 2, `画布节点数 ${dropped}`);

const handleCenter = (nodeIndex, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const handle = nodes[${nodeIndex}]?.querySelector('.react-flow__handle-${side}');
    if (!handle) return 'null';
    const r = handle.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

const source = await handleCenter(0, 'right');
const target = await handleCenter(1, 'left');
record(
  '节点存在四向锚点',
  source !== null && target !== null,
  `源锚点 ${JSON.stringify(source)}，目标锚点 ${JSON.stringify(target)}`,
);

const readEdges = () =>
  asJson(`(() => {
    const paths = [...document.querySelectorAll('.react-flow__edge-path')];
    const arrow = document.querySelector('marker.react-flow__arrowhead polyline');
    const active = document.querySelector('button[role="radio"][data-active]');
    return JSON.stringify({
      count: paths.length,
      d: paths[0]?.getAttribute('d') ?? null,
      markerEnd: paths[0]?.getAttribute('marker-end') ?? null,
      stroke: paths[0] ? getComputedStyle(paths[0]).stroke : null,
      arrowStroke: arrow ? getComputedStyle(arrow).stroke : null,
      activeType: active?.textContent.trim() ?? null,
      status: document.querySelector('footer').innerText.replace(/\\s+/g, ' '),
    });
  })()`);

await drag(source, target);
const connected = await readEdges();

record(
  '拖拽锚点生成连线',
  connected.count === 1,
  `DOM 连线数 ${connected.count}，状态栏「${connected.status}」`,
);
record(
  '连线路径已生成',
  Boolean(connected.d) && connected.d.length > 10,
  `d="${connected.d?.slice(0, 48)}…"`,
);
record('连线带箭头 marker', Boolean(connected.markerEnd), `marker-end 已设置`);
record(
  '连线取色走主题变量 --edge',
  connected.stroke === EDGE_STROKE && connected.arrowStroke === EDGE_STROKE,
  `线 ${connected.stroke}，箭头 ${connected.arrowStroke}（期望 ${EDGE_STROKE}）`,
);

const clickEdgeType = async (label) => {
  const result = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button[role="radio"]')].find((b) => b.textContent.trim() === '${label}');
    if (!btn) return 'not-found';
    btn.click();
    return 'ok';
  })()`);
  await sleep(250);
  const state = await readEdges();
  return { result, state };
};

const smoothstep = connected;

const curved = await clickEdgeType('曲线');
record(
  '切到曲线：路径变为三次贝塞尔',
  curved.result === 'ok' &&
    curved.state.count === 1 &&
    curved.state.d.includes('C') &&
    curved.state.activeType === '曲线',
  `点击返回 ${curved.result}，d="${curved.state.d?.slice(0, 40)}…"（含 C），高亮项「${curved.state.activeType}」`,
);

const straight = await clickEdgeType('直线');
record(
  '切到直线：路径退化为两点直连',
  straight.state.count === 1 &&
    !/[CQA]/.test(straight.state.d) &&
    (straight.state.d.match(/L/g) ?? []).length === 1,
  `d="${straight.state.d}"，高亮项「${straight.state.activeType}」`,
);

const back = await clickEdgeType('折线');
record(
  '切回折线：路径重新出现折角',
  back.state.count === 1 && /[LQ]/.test(back.state.d) && back.state.activeType === '折线',
  `状态栏「${back.state.status}」，高亮项「${back.state.activeType}」`,
);

// React Flow 以锚点「外沿」作为连线端点，所以比对的是锚点外侧边而非中心
const endpoints = await asJson(`(() => {
  const path = document.querySelector('.react-flow__edge-path');
  const matrix = path.getScreenCTM();
  const toScreen = (p) => ({ x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f });
  const start = toScreen(path.getPointAtLength(0));
  const end = toScreen(path.getPointAtLength(path.getTotalLength()));
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  const outerEdge = (index, side) => {
    const r = nodes[index].querySelector('.react-flow__handle-' + side).getBoundingClientRect();
    return side === 'right'
      ? { x: r.right, y: r.top + r.height / 2 }
      : { x: r.left, y: r.top + r.height / 2 };
  };
  const a = outerEdge(0, 'right');
  const b = outerEdge(1, 'left');
  return JSON.stringify({
    startDelta: Math.hypot(start.x - a.x, start.y - a.y),
    endDelta: Math.hypot(end.x - b.x, end.y - b.y),
  });
})()`);
record(
  '连线端点吸附在锚点外沿',
  endpoints.startDelta <= 1 && endpoints.endDelta <= 1,
  `起点偏差 ${endpoints.startDelta.toFixed(2)}px，终点偏差 ${endpoints.endDelta.toFixed(2)}px`,
);

record(
  '运行期无 React Flow 警告',
  consoleWarnings.length === 0,
  consoleWarnings.length === 0 ? '无警告' : consoleWarnings.join(' | '),
);

await mkdir(OUT_DIR, { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm3.png'), Buffer.from(shot.data, 'base64'));
console.log('截图已写入 .verify/m3.png');

const failed = report.filter((row) => !row.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);

ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
