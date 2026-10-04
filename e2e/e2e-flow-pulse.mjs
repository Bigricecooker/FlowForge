/** 真拖拽建图、连线与选中：验证红点只沿命中的实际路径移动。 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5187;
const CDP_PORT = 9222;
const OUT_DIR = join(process.cwd(), '.verify');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const target = path === '/' ? '/index.html' : path;
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

const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = pages.find((item) => item.type === 'page');
if (!page) throw new Error('没有找到可用的浏览器页面');
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
  if (
    message.method === 'Runtime.consoleAPICalled' &&
    ['warning', 'error'].includes(message.params.type)
  ) {
    warnings.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    warnings.push(message.params.exceptionDetails.text);
  }
  const callback = pending.get(message.id);
  if (callback) {
    pending.delete(message.id);
    callback(message);
  }
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
const readJson = async (expression) => JSON.parse(await evaluate(expression));
async function mouse(type, x, y, modifiers = 0) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'mouse',
    modifiers,
  });
}
async function click(point, modifiers = 0) {
  await mouse('mousePressed', point.x, point.y, modifiers);
  await mouse('mouseReleased', point.x, point.y, modifiers);
  await sleep(120);
}
async function drag(from, to) {
  await mouse('mousePressed', from.x, from.y);
  for (let step = 1; step <= 20; step += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * step) / 20,
      from.y + ((to.y - from.y) * step) / 20,
    );
    await sleep(12);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(180);
}
const report = [];
function record(label, ok, detail) {
  report.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1200);

const layout = await readJson(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const r = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((item) => { const box = item.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }),
    canvas: { left: r.left, top: r.top },
  });
})()`);
const { left, top } = layout.canvas;
for (const point of [
  { x: left + 150, y: top + 180 },
  { x: left + 380, y: top + 180 },
  { x: left + 610, y: top + 180 },
  { x: left + 610, y: top + 410 },
]) {
  await drag(layout.items[0], point);
}

const handle = (index, side) =>
  readJson(`(() => {
    const node = document.querySelectorAll('.react-flow__node')[${index}];
    const r = node.querySelector('.react-flow__handle-${side}').getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
for (const [source, sourceSide, target, targetSide] of [
  [0, 'right', 1, 'left'],
  [1, 'right', 2, 'left'],
  [2, 'bottom', 3, 'top'],
]) {
  await drag(await handle(source, sourceSide), await handle(target, targetSide));
}
await sleep(600);

const state = () =>
  readJson(`(() => JSON.stringify([...document.querySelectorAll('.react-flow__edge')].map((edge) => {
    const path = edge.querySelector('.react-flow__edge-path');
    const pulse = edge.querySelector('[data-flow-pulse]');
    const style = pulse ? getComputedStyle(pulse) : null;
    return {
      pulse: !!pulse,
      pathBound: !!pulse && pulse.getAttribute('d') === path?.getAttribute('d'),
      stroke: style?.stroke ?? null,
      width: style?.strokeWidth ?? null,
      dash: style?.strokeDasharray ?? null,
    };
  })))()`);

const initial = await state();
record(
  '三条连线建立后不生成流动圆点',
  initial.length === 3 && initial.every((edge) => !edge.pulse),
  JSON.stringify(initial),
);

const edgeMidpoint = (index) =>
  readJson(`(() => {
    const path = document.querySelectorAll('.react-flow__edge-path')[${index}];
    const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
    return JSON.stringify({ x: p.x, y: p.y });
  })()`);
await click(await edgeMidpoint(0));
const one = await state();
record(
  '选中一条连线只激活该线',
  one.filter((edge) => edge.pulse).length === 1 && one[0].pulse,
  JSON.stringify(one),
);
record(
  '小红点沿可见路径密集排列',
  one[0].pathBound &&
    one[0].stroke === 'rgb(239, 68, 68)' &&
    one[0].width === '3px' &&
    one[0].dash === '0px, 20px',
  JSON.stringify(one[0]),
);

const movement = await readJson(`(async () => {
  const pulse = document.querySelector('.react-flow__edge [data-flow-pulse]');
  const animation = pulse.getAnimations()[0];
  animation.pause();
  animation.currentTime = 100;
  await new Promise(requestAnimationFrame);
  const early = parseFloat(getComputedStyle(pulse).strokeDashoffset);
  animation.currentTime = 400;
  await new Promise(requestAnimationFrame);
  const late = parseFloat(getComputedStyle(pulse).strokeDashoffset);
  const length = pulse.getTotalLength();
  animation.play();
  return JSON.stringify({ early, late, length });
})()`);
record(
  '多个圆点从起点持续向终点流动',
  movement.length > 60 && movement.late < movement.early - 5,
  `路径 ${movement.length.toFixed(1)}px，偏移 ${movement.early.toFixed(1)} → ${movement.late.toFixed(1)}px`,
);

const curveButton = await readJson(`(() => {
  const r = document.querySelectorAll('button[role="radio"]')[1].getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`);
await click(curveButton);
await sleep(600);
const afterTypeChange = await state();
record(
  '切换线型后红点仍绑定当前路径',
  afterTypeChange.length === 3 && afterTypeChange[0].pulse && afterTypeChange[0].pathBound,
  JSON.stringify(afterTypeChange),
);

const nodeCenter = (index) =>
  readJson(`(() => {
    const r = document.querySelectorAll('.react-flow__node')[${index}].getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
await click(await nodeCenter(1));
const two = await state();
record(
  '选中一个节点激活所有入边和出边',
  two.map((edge) => edge.pulse).join(',') === 'true,true,false',
  JSON.stringify(two),
);

// Windows 上 React Flow 的多选键是 Ctrl，先发真实 keydown 才能更新 useKeyPress。
await send('Input.dispatchKeyEvent', {
  type: 'rawKeyDown',
  key: 'Control',
  code: 'ControlLeft',
  windowsVirtualKeyCode: 17,
  modifiers: 2,
});
await sleep(50);
await click(await nodeCenter(2), 2);
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Control',
  code: 'ControlLeft',
  windowsVirtualKeyCode: 17,
  modifiers: 0,
});
const three = await state();
record(
  '多选节点激活相邻连线的并集',
  three.length === 3 && three.every((edge) => edge.pulse && edge.pathBound),
  JSON.stringify(three),
);

await mkdir(OUT_DIR, { recursive: true });
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'flow-pulse.png'), Buffer.from(screenshot.data, 'base64'));

await click({ x: left + 40, y: top + 520 });
const cleared = await state();
record(
  '取消选中后移除全部动画红点',
  cleared.every((edge) => !edge.pulse),
  JSON.stringify(cleared),
);

// A→C 的直线会穿过 B；智能边异步绕行后，红点仍须绑定最终路径。
await drag(await handle(0, 'right'), await handle(2, 'left'));
await sleep(650);
await click(await nodeCenter(2));
const routed = await state();
const obstacleRoute = await readJson(`(() => {
  const path = document.querySelectorAll('.react-flow__edge-path')[3];
  const middle = document.querySelectorAll('.react-flow__node')[1].getBoundingClientRect();
  const samples = Array.from({ length: 80 }, (_, i) => path.getPointAtLength(path.getTotalLength() * i / 79).matrixTransform(path.getScreenCTM()));
  const crossings = samples.filter((p) => p.x > middle.left + 2 && p.x < middle.right - 2 && p.y > middle.top + 2 && p.y < middle.bottom - 2);
  return JSON.stringify({ crossings: crossings.length });
})()`);
record(
  '异步避障路径上的红点仍绑定可见连线',
  routed.length === 4 && routed[3].pulse && routed[3].pathBound && obstacleRoute.crossings === 0,
  `路径绑定 ${routed[3]?.pathBound}，80 个采样点中穿越 ${obstacleRoute.crossings} 个`,
);
record('运行期无警告或异常', warnings.length === 0, warnings.join(' | ') || '无');

const failed = report.filter((item) => !item.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);
ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
