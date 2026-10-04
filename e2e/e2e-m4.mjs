/**
 * M4 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 全选 → 复制粘贴 → 删除 → 双击改名 → Shift 框选 → 删除节点连带清理连线。
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
const warnings = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
    warnings.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
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

async function mouse(type, x, y, modifiers = 0) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    modifiers,
    pointerType: 'mouse',
  });
}

async function drag(from, to, modifiers = 0) {
  await mouse('mousePressed', from.x, from.y, modifiers);
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
      modifiers,
    );
    await sleep(12);
  }
  await mouse('mouseReleased', to.x, to.y, modifiers);
  await sleep(220);
}

async function doubleClick(x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 2,
    pointerType: 'mouse',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 2,
    pointerType: 'mouse',
  });
  await sleep(220);
}

const KEYS = {
  a: { key: 'a', code: 'KeyA', vk: 65 },
  c: { key: 'c', code: 'KeyC', vk: 67 },
  v: { key: 'v', code: 'KeyV', vk: 86 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
};

async function key(name, modifiers = 0) {
  const spec = KEYS[name];
  // 不传 nativeVirtualKeyCode：带上它时 Chrome 会把 Ctrl+C / Ctrl+V 当作浏览器编辑命令，
  // 页面收不到 keydown（Ctrl+A 不受影响，所以只挂这两个）。
  const base = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.vk, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
}

async function setShift(down) {
  await send('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    modifiers: down ? SHIFT : 0,
  });
}

const CTRL = 2;
const SHIFT = 8;

const report = [];
const record = (label, ok, detail) => {
  report.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
};

const state = () =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const centers = nodes.map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    return JSON.stringify({
      nodes: nodes.length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      selectedNodes: document.querySelectorAll('.react-flow__node.selected').length,
      selectedEdges: document.querySelectorAll('.react-flow__edge.selected').length,
      centers,
      // 选中上下文的界面回显在 M7 之后移进了「节点属性」面板（要点控件栏才出现），
      // 本场景只做编辑操作，因此不再读它；面板读选中的验证在 e2e-m7.mjs 里。
      status: document.querySelector('footer').innerText.replace(/\\s+/g, ' '),
      zoom: document.querySelector('.react-flow__viewport').style.transform,
      editorOpen: Boolean(document.querySelector('textarea[aria-label="节点文字"]')),
      labels: nodes.map((el) => el.textContent.trim()),
    });
  })()`);

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

const spotA = { x: layout.canvas.left + 220, y: layout.canvas.top + 150 };
const spotB = { x: layout.canvas.left + 520, y: layout.canvas.top + 320 };
const handleCenter = (index, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const handle = nodes[${index}].querySelector('.react-flow__handle-${side}');
    const r = handle.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

await drag(layout.items[0], spotA);
await drag(layout.items[2], spotB);
await drag(await handleCenter(0, 'right'), await handleCenter(1, 'left'));

const built = await state();
record(
  '前置：两个节点一条连线',
  built.nodes === 2 && built.edges === 1,
  `节点 ${built.nodes}，连线 ${built.edges}`,
);

// ---- 全选 ----
await key('a', CTRL);
const selectedAll = await state();
record(
  'Ctrl+A 全选',
  selectedAll.selectedNodes === 2 && selectedAll.selectedEdges === 1,
  `选中节点 ${selectedAll.selectedNodes}，选中连线 ${selectedAll.selectedEdges}`,
);

// ---- 复制粘贴 ----
await key('c', CTRL);
await key('v', CTRL);
const pasted = await state();
const pairs = pasted.centers.filter((center) =>
  built.centers.some(
    (origin) => Math.abs(center.x - origin.x - 24) <= 1 && Math.abs(center.y - origin.y - 24) <= 1,
  ),
);
record(
  'Ctrl+C / Ctrl+V 粘贴并偏移 24px',
  pasted.nodes === 4 && pasted.edges === 2 && pairs.length === 2,
  `节点 ${pasted.nodes}，连线 ${pasted.edges}，命中 24px 偏移的节点 ${pairs.length} 个`,
);
record(
  '粘贴结果落在新副本上（原选中被释放）',
  pasted.selectedNodes === 2 && pasted.selectedEdges === 0,
  `选中节点 ${pasted.selectedNodes}，选中连线 ${pasted.selectedEdges}`,
);

await mkdir(OUT_DIR, { recursive: true });
let shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm4.png'), Buffer.from(shot.data, 'base64'));

// ---- Esc 取消选中 ----
await key('Escape');
const cleared = await state();
record(
  'Esc 取消选中',
  cleared.selectedNodes === 0 && cleared.selectedEdges === 0,
  `选中节点 ${cleared.selectedNodes}，选中连线 ${cleared.selectedEdges}`,
);

// ---- 全选删除 ----
await key('a', CTRL);
await key('Delete');
const emptied = await state();
record(
  'Ctrl+A 后 Delete 清空画布',
  emptied.nodes === 0 && emptied.edges === 0,
  `状态栏「${emptied.status}」`,
);

// ---- 双击改名 ----
await drag(layout.items[1], spotA);
await doubleClick(spotA.x, spotA.y);
const editing = await state();
record('双击节点打开内联编辑框', editing.editorOpen, `编辑框存在：${editing.editorOpen}`);
record('双击不触发画布缩放', editing.zoom === built.zoom, `缩放 transform 未变：${editing.zoom}`);
const editorAppearance = await asJson(`(() => {
  const editor = document.querySelector('textarea[aria-label="节点文字"]');
  const style = getComputedStyle(editor);
  return JSON.stringify({
    outlineStyle: style.outlineStyle,
    borderWidth: style.borderWidth,
    background: style.backgroundColor,
  });
})()`);
record(
  '编辑文字时不出现输入框边框或底色',
  editorAppearance.outlineStyle === 'none' &&
    editorAppearance.borderWidth === '0px' &&
    editorAppearance.background === 'rgba(0, 0, 0, 0)',
  JSON.stringify(editorAppearance),
);

await evaluate(`(() => {
  const area = document.querySelector('textarea[aria-label="节点文字"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, '已改名节点');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(120);
shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm4-rename.png'), Buffer.from(shot.data, 'base64'));

await key('Enter'); // 焦点在 textarea 上，Enter 由编辑器自己处理
const renamed = await state();
record(
  'Enter 提交改名',
  renamed.labels.some((label) => label.includes('已改名节点')) && !renamed.editorOpen,
  `节点文字：${JSON.stringify(renamed.labels)}`,
);

// ---- Shift 框选 ----
await key('Escape');
const beforeBand = await state();
record('框选前无选中', beforeBand.selectedNodes === 0, `选中 ${beforeBand.selectedNodes}`);
// React Flow 用 useKeyPress 跟踪「框选键按下」，光靠鼠标事件的 shiftKey 不够，要先真按 Shift
await setShift(true);
await drag({ x: spotA.x - 140, y: spotA.y - 110 }, { x: spotA.x + 140, y: spotA.y + 110 }, SHIFT);
await setShift(false);
const banded = await state();
record(
  'Shift 拖拽框选命中节点',
  banded.selectedNodes >= 1,
  `框选后选中节点 ${banded.selectedNodes}`,
);

// ---- 删除节点连带清理连线 ----
await key('Escape');
await key('a', CTRL);
await key('Delete');
await drag(layout.items[0], spotA);
await drag(layout.items[2], spotB);
await drag(await handleCenter(0, 'right'), await handleCenter(1, 'left'));
const reconnected = await state();
record(
  '重建两节点一连线',
  reconnected.nodes === 2 && reconnected.edges === 1,
  `节点 ${reconnected.nodes}，连线 ${reconnected.edges}`,
);

await mouse('mousePressed', spotA.x, spotA.y);
await mouse('mouseReleased', spotA.x, spotA.y);
await sleep(150);
await key('Delete');
const afterNodeDelete = await state();
record(
  '删除节点时相连的连线一并清理',
  afterNodeDelete.nodes === 1 && afterNodeDelete.edges === 0,
  `剩余节点 ${afterNodeDelete.nodes}，剩余连线 ${afterNodeDelete.edges}，状态栏「${afterNodeDelete.status}」`,
);

record(
  '运行期无控制台警告',
  warnings.length === 0,
  warnings.length === 0 ? '无警告' : warnings.join(' | '),
);

const failed = report.filter((row) => !row.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);

ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
