/**
 * M5 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 分五段，每段都重新加载页面以获得干净的撤销历史。
 *   1. 落图/连线的撤销与重做（含历史耗尽、新操作清空 future）
 *   2. 拖拽粒度：一次拖拽只产生一步撤销，且不产生空撤销
 *   3. 改名与切换线型可撤销
 *   4. 删除与粘贴可撤销
 *   5. 视口缩放平移不入栈
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5182;
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
  for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount,
      pointerType: 'mouse',
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount,
      pointerType: 'mouse',
    });
  }
  await sleep(250);
}

const KEYS = {
  a: 'KeyA',
  c: 'KeyC',
  v: 'KeyV',
  y: 'KeyY',
  z: 'KeyZ',
};
const VK = { KeyA: 65, KeyC: 67, KeyV: 86, KeyY: 89, KeyZ: 90 };

async function key(name, modifiers = 0) {
  if (name === 'Delete' || name === 'Enter' || name === 'Escape') {
    const vk = { Delete: 46, Enter: 13, Escape: 27 }[name];
    const base = { key: name, code: name, windowsVirtualKeyCode: vk, modifiers };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(200);
    return;
  }
  const code = KEYS[name.toLowerCase()];
  const isUpper = name !== name.toLowerCase();
  const base = {
    key: isUpper ? name.toUpperCase() : name,
    code,
    windowsVirtualKeyCode: VK[code],
    modifiers,
  };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
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
    const centers = nodes
      .map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })
      .sort((a, b) => a.x - b.x || a.y - b.y);
    return JSON.stringify({
      nodes: nodes.length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      centers,
      labels: nodes.map((el) => el.textContent.trim()).sort(),
      edgePath: document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? null,
      edgeTypeActive: document.querySelector('button[role="radio"][data-active]')?.textContent.trim() ?? null,
      viewport: document.querySelector('.react-flow__viewport').style.transform,
      status: document.querySelector('footer').innerText.replace(/\\s+/g, ' '),
    });
  })()`);

const layout = () =>
  evaluate(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
    canvas: { left: flow.left, top: flow.top },
  });
})()`).then(JSON.parse);

const handleCenter = (index, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const handle = nodes[${index}].querySelector('.react-flow__handle-${side}');
    const r = handle.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

/** 重新加载页面并搭建「两个节点 + 一条连线」的初始场景。 */
async function setupScene() {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1200);
  const grid = await layout();
  const a = { x: grid.canvas.left + 220, y: grid.canvas.top + 150 };
  const b = { x: grid.canvas.left + 520, y: grid.canvas.top + 320 };
  await drag(grid.items[0], a);
  await drag(grid.items[2], b);
  await drag(await handleCenter(0, 'right'), await handleCenter(1, 'left'));
  return { grid, a, b };
}

await send('Page.enable');
await send('Runtime.enable');
await mkdir(OUT_DIR, { recursive: true });

// ---------------- 1. 落图与连线的撤销 / 重做 ----------------
console.log('\n[1] 落图与连线的撤销 / 重做');
await setupScene();
const built = await state();
record('初始：2 节点 1 连线', built.nodes === 2 && built.edges === 1, `状态栏「${built.status}」`);

await key('z', CTRL);
const undo1 = await state();
record(
  '撤销一次 → 连线消失',
  undo1.nodes === 2 && undo1.edges === 0,
  `节点 ${undo1.nodes}，连线 ${undo1.edges}`,
);

await key('z', CTRL);
const undo2 = await state();
record(
  '再撤销 → 剩一个节点',
  undo2.nodes === 1 && undo2.edges === 0,
  `节点 ${undo2.nodes}，连线 ${undo2.edges}`,
);

await key('z', CTRL);
const undo3 = await state();
record(
  '再撤销 → 画布清空',
  undo3.nodes === 0 && undo3.edges === 0,
  `节点 ${undo3.nodes}，连线 ${undo3.edges}`,
);

await key('z', CTRL);
const undo4 = await state();
record('历史耗尽后再撤销无副作用', undo4.nodes === 0 && undo4.edges === 0, `节点 ${undo4.nodes}`);

await key('Z', CTRL | SHIFT);
const redo1 = await state();
record('重做一次 → 第一个节点回来', redo1.nodes === 1 && redo1.edges === 0, `节点 ${redo1.nodes}`);
await key('Z', CTRL | SHIFT);
await key('Z', CTRL | SHIFT);
const redo3 = await state();
record(
  '重做三次 → 完整回到初始（含连线）',
  redo3.nodes === 2 && redo3.edges === 1,
  `节点 ${redo3.nodes}，连线 ${redo3.edges}`,
);

// 新操作应清空 redo 栈
await key('z', CTRL);
await drag((await layout()).items[1], {
  x: (await layout()).canvas.left + 300,
  y: (await layout()).canvas.top + 400,
});
const afterNewEdit = await state();
await key('Z', CTRL | SHIFT);
const redoAfterNewEdit = await state();
record(
  '新编辑后 redo 栈被清空',
  redoAfterNewEdit.nodes === afterNewEdit.nodes && redoAfterNewEdit.edges === afterNewEdit.edges,
  `新编辑后 ${afterNewEdit.nodes} 节点 / redo 后仍 ${redoAfterNewEdit.nodes} 节点`,
);

// ---------------- 2. 拖拽粒度 ----------------
console.log('\n[2] 拖拽粒度');
await setupScene();
const beforeDrag = await state();
const dragFrom = beforeDrag.centers[0];
await drag({ x: dragFrom.x, y: dragFrom.y }, { x: dragFrom.x + 150, y: dragFrom.y + 90 });
const afterDrag = await state();
const moved = Math.abs(afterDrag.centers[0].x - beforeDrag.centers[0].x) > 100;
record(
  '拖拽确实移动了节点',
  moved,
  `中心 ${JSON.stringify(beforeDrag.centers[0])} → ${JSON.stringify(afterDrag.centers[0])}`,
);

await key('z', CTRL);
const afterDragUndo = await state();
record(
  '一次 Ctrl+Z 回到拖拽前（不是逐帧回退）',
  JSON.stringify(afterDragUndo.centers) === JSON.stringify(beforeDrag.centers) &&
    afterDragUndo.nodes === beforeDrag.nodes &&
    afterDragUndo.edges === beforeDrag.edges,
  `位置 ${JSON.stringify(afterDragUndo.centers)}，节点 ${afterDragUndo.nodes}，连线 ${afterDragUndo.edges}`,
);

// 点一下但不拖动，不应产生空撤销
await mouse('mousePressed', beforeDrag.centers[0].x, beforeDrag.centers[0].y);
await mouse('mouseReleased', beforeDrag.centers[0].x, beforeDrag.centers[0].y);
await sleep(200);
const afterClick = await state();
await key('z', CTRL);
const afterClickUndo = await state();
record(
  '点击未拖动不产生空撤销',
  afterClick.nodes === 2 && afterClick.edges === 1 && afterClickUndo.edges === 0,
  `点击后 ${afterClick.nodes} 节点 / 撤销后连线 ${afterClickUndo.edges}（应撤销掉"连线"而非空操作）`,
);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, 'm5.png'), Buffer.from(shot.data, 'base64'));

// ---------------- 3. 改名与切换线型 ----------------
console.log('\n[3] 改名与切换线型');
await setupScene();
const beforeRename = await state();
await doubleClick(beforeRename.centers[0].x, beforeRename.centers[0].y);
await evaluate(`(() => {
  const area = document.querySelector('textarea[aria-label="节点文字"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, '改过的名字');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await key('Enter');
const renamed = await state();
record('改名生效', renamed.labels.includes('改过的名字'), `标签 ${JSON.stringify(renamed.labels)}`);
await key('z', CTRL);
const renameUndone = await state();
record(
  '撤销改名',
  JSON.stringify(renameUndone.labels) === JSON.stringify(beforeRename.labels),
  `标签回到 ${JSON.stringify(renameUndone.labels)}`,
);

const smoothPath = (await state()).edgePath;
await evaluate(`(() => {
  [...document.querySelectorAll('button[role="radio"]')].find((b) => b.textContent.trim() === '曲线').click();
  return 'ok';
})()`);
await sleep(250);
const switched = await state();
record(
  '切到曲线',
  switched.edgeTypeActive === '曲线' && switched.edgePath.includes('C'),
  `高亮「${switched.edgeTypeActive}」`,
);
await key('z', CTRL);
const switchUndone = await state();
record(
  '撤销切换线型（路径与工具条高亮一起还原）',
  switchUndone.edgeTypeActive === '折线' && switchUndone.edgePath === smoothPath,
  `高亮「${switchUndone.edgeTypeActive}」，路径 ${switchUndone.edgePath === smoothPath ? '已还原' : '未还原'}`,
);

// ---------------- 4. 删除与粘贴 ----------------
console.log('\n[4] 删除与粘贴');
await setupScene();
await mouse('mousePressed', (await state()).centers[0].x, (await state()).centers[0].y);
await mouse('mouseReleased', (await state()).centers[0].x, (await state()).centers[0].y);
await sleep(150);
await key('Delete');
const deleted = await state();
record(
  '删除节点（连带连线）',
  deleted.nodes === 1 && deleted.edges === 0,
  `节点 ${deleted.nodes}，连线 ${deleted.edges}`,
);
await key('z', CTRL);
const deleteUndone = await state();
record(
  '撤销删除（节点与连线一起回来）',
  deleteUndone.nodes === 2 && deleteUndone.edges === 1,
  `节点 ${deleteUndone.nodes}，连线 ${deleteUndone.edges}`,
);

await key('a', CTRL);
await key('c', CTRL);
await key('v', CTRL);
const pasted = await state();
record(
  '粘贴出新副本',
  pasted.nodes === 4 && pasted.edges === 2,
  `节点 ${pasted.nodes}，连线 ${pasted.edges}`,
);
await key('z', CTRL);
const pasteUndone = await state();
record(
  '撤销粘贴（副本与其连线一起消失）',
  pasteUndone.nodes === 2 && pasteUndone.edges === 1,
  `节点 ${pasteUndone.nodes}，连线 ${pasteUndone.edges}`,
);

// ---------------- 5. 视口不入栈 ----------------
console.log('\n[5] 视口不入栈');
await setupScene();
const beforeViewport = await state();
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: Math.round(beforeViewport.centers[0].x),
  y: Math.round(beforeViewport.centers[0].y),
  deltaX: 0,
  deltaY: -240,
  pointerType: 'mouse',
});
await sleep(400);
const zoomed = await state();
record('滚轮缩放生效', zoomed.viewport !== beforeViewport.viewport, `视口 ${zoomed.viewport}`);
await key('z', CTRL);
const afterZoomUndo = await state();
record(
  'Ctrl+Z 不动视口，只撤销文档编辑',
  afterZoomUndo.viewport === zoomed.viewport && afterZoomUndo.edges === 0,
  `视口保持 ${afterZoomUndo.viewport === zoomed.viewport}，连线 ${beforeViewport.edges} → ${afterZoomUndo.edges}`,
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
