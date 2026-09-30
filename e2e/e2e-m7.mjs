/**
 * M7 端到端验证（项目回归测试，见 AGENTS.md 的回归纪律）：
 * 暂留区作为面板容器的完整链路——空状态 → 点控件栏开分页 → 面板读到选中上下文 →
 * 属性随拖动实时更新 → 分页切换/关闭 → 折叠与自动展开 → 控件栏固定宽度。
 *
 * 用法：node .verify/e2e-m7.mjs --panels=1|2
 *   --panels=1 交付态（只有「节点属性」）
 *   --panels=2 临时注入第二个占位面板，用于验证多分页切换（验证后会把补丁还原）
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PANEL_COUNT = Number(
  (process.argv.find((arg) => arg.startsWith('--panels=')) ?? '--panels=1').split('=')[1],
);

const DIST = join(process.cwd(), 'dist');
const PORT = 5184;
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
  // 先在按下点发一次移动：React Flow 以第一次 pointermove 作为拖拽锚点，
  // 若无这次"停留"，第一步的位移会被吞掉，位移量就会少一个步长。
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

/** 一次取回暂留区与面板的全部可观测状态。 */
const ui = () =>
  asJson(`(() => {
    const rail = document.querySelector('nav[aria-label="暂留区面板"]');
    const area = rail?.parentElement ?? null;
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      title: tab.textContent.trim(),
      selected: tab.getAttribute('aria-selected') === 'true',
    }));
    const railButtons = [...(rail?.querySelectorAll('button') ?? [])].map((button) => ({
      title: button.title,
      active: button.hasAttribute('data-active'),
      open: button.hasAttribute('data-open'),
    }));
    const panel = document.querySelector('[role="tabpanel"]');
    const props = {};
    if (panel) for (const dt of panel.querySelectorAll('dt')) props[dt.textContent.trim()] = dt.nextElementSibling?.textContent?.trim() ?? '';
    return JSON.stringify({
      railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
      areaWidth: area ? Math.round(area.getBoundingClientRect().width) : null,
      railButtons,
      tabs,
      bodyText: panel ? panel.textContent.trim() : null,
      props,
    });
  })()`);

const clickRail = (index) =>
  evaluate(`(() => {
    const buttons = [...document.querySelectorAll('nav[aria-label="暂留区面板"] button')];
    if (!buttons[${index}]) return 'not-found';
    buttons[${index}].click();
    return 'ok';
  })()`);

const clickByTitle = (title) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.title === ${JSON.stringify(title)});
    if (!el) return 'not-found';
    el.click();
    return 'ok';
  })()`);

const clickTab = (index) =>
  evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    if (!tabs[${index}]) return 'not-found';
    tabs[${index}].click();
    return 'ok';
  })()`);

const clickClose = (index) =>
  evaluate(`(() => {
    const closes = [...document.querySelectorAll('[role="tablist"] button[aria-label^="关闭"]')];
    if (!closes[${index}]) return 'not-found';
    closes[${index}].click();
    return 'ok';
  })()`);

const parsePosition = (text) => {
  const [x, y] = (text ?? '').split(',').map((part) => Number(part.trim()));
  return { x, y };
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1300);
await mkdir(OUT_DIR, { recursive: true });

console.log(`\n[暂留区容器 · 面板数 ${PANEL_COUNT}]`);

const initial = await ui();
record(
  '初始：控件栏就位、无分页、主体为空状态',
  initial.railButtons.length === PANEL_COUNT &&
    initial.tabs.length === 0 &&
    initial.bodyText === '从右侧控件栏选择一个面板',
  `控件栏 ${initial.railButtons.length} 个图标，分页 ${initial.tabs.length} 个，主体「${initial.bodyText}」`,
);
record(
  '控件栏固定宽度、暂留区默认宽度',
  initial.railWidth === 48 && initial.areaWidth === 368,
  `控件栏 ${initial.railWidth}px，暂留区含控件栏 ${initial.areaWidth}px（320 + 48）`,
);

await clickRail(0);
await sleep(200);
const opened = await ui();
record(
  '点控件栏图标后顶栏才出现分页',
  opened.tabs.length === 1 && opened.tabs[0].title === '节点属性' && opened.tabs[0].selected,
  `分页 ${JSON.stringify(opened.tabs)}`,
);
record(
  '控件栏当前项高亮',
  opened.railButtons[0].active && opened.railButtons[0].open,
  `active=${opened.railButtons[0].active}，open=${opened.railButtons[0].open}`,
);

// 多分页场景：临时第二面板
if (PANEL_COUNT === 2) {
  await clickRail(1);
  await sleep(200);
  const twoTabs = await ui();
  record(
    '打开第二个面板后出现两个分页、后者激活',
    twoTabs.tabs.length === 2 && twoTabs.tabs[1].selected && !twoTabs.tabs[0].selected,
    `分页 ${JSON.stringify(twoTabs.tabs.map((t) => `${t.title}${t.selected ? '(选中)' : ''}`))}`,
  );
  record(
    '面板主体切换为第二个面板',
    (twoTabs.bodyText ?? '').includes('占位面板 B'),
    `主体「${twoTabs.bodyText}」`,
  );
  record(
    '控件栏标记已打开但未激活的项',
    twoTabs.railButtons[0].open && !twoTabs.railButtons[0].active && twoTabs.railButtons[1].active,
    `按钮[0] open=${twoTabs.railButtons[0].open}/active=${twoTabs.railButtons[0].active}，按钮[1] active=${twoTabs.railButtons[1].active}`,
  );

  await clickTab(0);
  await sleep(200);
  const switched = await ui();
  record(
    '点顶栏分页切回第一个面板',
    switched.tabs[0].selected &&
      !switched.tabs[1].selected &&
      !(switched.bodyText ?? '').includes('占位面板 B'),
    `主体「${(switched.bodyText ?? '').slice(0, 24)}…」`,
  );

  await clickClose(0);
  await sleep(200);
  const closedOne = await ui();
  record(
    '关闭当前分页后落到相邻分页',
    closedOne.tabs.length === 1 && closedOne.tabs[0].selected,
    `剩余分页 ${JSON.stringify(closedOne.tabs)}`,
  );
  await clickClose(0);
  await sleep(200);
  const closedAll = await ui();
  record(
    '关掉最后一个分页回到空状态',
    closedAll.tabs.length === 0 && closedAll.bodyText === '从右侧控件栏选择一个面板',
    `分页 ${closedAll.tabs.length} 个，主体「${closedAll.bodyText}」`,
  );
  await clickRail(0);
  await sleep(200);
}

// 面板内容：读到选中上下文，并随拖动实时更新
const layout = await asJson(`(() => {
  const items = [...document.querySelectorAll('ul > li')];
  const flow = document.querySelector('.react-flow').getBoundingClientRect();
  return JSON.stringify({
    items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
    canvas: { left: flow.left, top: flow.top },
  });
})()`);

const emptyProps = await ui();
record(
  '未选中时面板提示未选中',
  emptyProps.bodyText === '未选中任何节点',
  `主体「${emptyProps.bodyText}」`,
);

const spot = { x: layout.canvas.left + 220, y: layout.canvas.top + 160 };
await drag(layout.items[0], spot);
await mouse('mousePressed', spot.x, spot.y);
await mouse('mouseReleased', spot.x, spot.y);
await sleep(250);

const selected = await ui();
record(
  '面板读到选中节点的属性',
  selected.props.图形 === '处理' &&
    selected.props.文字 === '处理' &&
    selected.props.尺寸 === '160 × 56' &&
    Number.isFinite(parsePosition(selected.props.位置).x),
  `属性 ${JSON.stringify(selected.props)}`,
);

const beforeDragPosition = parsePosition(selected.props.位置);
await drag(spot, { x: spot.x + 140, y: spot.y + 90 });
const afterDrag = await ui();
const afterDragPosition = parsePosition(afterDrag.props.位置);

// 节点真实坐标（DOM 上的世界坐标 transform）——面板数值应当与它一致
const nodeWorld = await asJson(`(() => {
  const el = document.querySelector('.react-flow__node');
  const match = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(el.style.transform);
  return JSON.stringify({ x: Number(match[1]), y: Number(match[2]) });
})()`);

record(
  '拖动后节点确实移动了',
  Math.abs(afterDragPosition.x - beforeDragPosition.x) > 100,
  `位移 ${(afterDragPosition.x - beforeDragPosition.x).toFixed(0)},${(afterDragPosition.y - beforeDragPosition.y).toFixed(0)}（指针位移 140,90）`,
);
record(
  '属性面板数值与节点真实坐标一致（拖动中实时更新）',
  Math.abs(afterDragPosition.x - nodeWorld.x) <= 1 &&
    Math.abs(afterDragPosition.y - nodeWorld.y) <= 1,
  `面板 ${afterDragPosition.x},${afterDragPosition.y} vs 节点 transform ${nodeWorld.x},${nodeWorld.y}`,
);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(OUT_DIR, `m7-panels${PANEL_COUNT}.png`), Buffer.from(shot.data, 'base64'));

// 折叠与自动展开
await clickClose(0);
await sleep(200);
const closedTab = await ui();
record(
  '关闭分页后回到空状态',
  closedTab.tabs.length === 0 && closedTab.bodyText === '从右侧控件栏选择一个面板',
  `分页 ${closedTab.tabs.length} 个`,
);

await clickByTitle('收起暂留区');
await sleep(250);
const collapsed = await ui();
record(
  '收起后面板区宽度归零、控件栏仍在',
  collapsed.areaWidth === 48 && collapsed.railWidth === 48,
  `暂留区总宽 ${collapsed.areaWidth}px（仅控件栏），控件栏 ${collapsed.railWidth}px`,
);

await clickRail(0);
await sleep(300);
const expanded = await ui();
record(
  '收起状态下点控件栏图标自动展开并显示面板',
  expanded.areaWidth === 368 && expanded.tabs.length === 1 && expanded.tabs[0].selected,
  `暂留区总宽 ${expanded.areaWidth}px，分页 ${JSON.stringify(expanded.tabs.map((t) => t.title))}`,
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
