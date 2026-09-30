/**
 * 诊断（不属于回归套件）：量化"线穿过第三个节点"这类残留问题的触发条件。
 *
 * 背景：上次修复只解决了"锚点朝向反了"导致的穿越（布局时按分层重挑锚点）。
 * 但 React Flow 内置的 smoothstep 只看两个端点，不感知其他节点，所以
 * **跨多层边的竖直段若恰好落在中间层某个节点所在的列上，就会穿过去**。
 *
 * 本脚本构造几种常见结构，量出到底哪些会触发。它只报告、不判失败——
 * 因为这是尚未修复的已知限制；等做了避障路由，再把它转成 e2e- 断言（要求 0 穿越）。
 *
 * 用法：node e2e/diag-edge-obstacles.mjs
 *
 * 生命周期：这是**临时探针**。避障落地后，把 A/B/D 三个用例转成 e2e- 断言（要求 0 穿越），
 * 然后删除本脚本——断言接管它的职责。用 `diag-` 前缀命名，所以不会被 `npm run e2e` 收进套件。
 *
 * 退出码：0 = 正常出了报告；2 = 脚本自身已过期（它依赖的界面结构变了），必须先更新脚本；
 * 1 = 脚本自身出错。注意"用例构造失败"不算套件失败，但会被标为无效，避免给出无意义的结论。
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = 5186;
const CDP_PORT = 9222;
const OUT_DIR = join(process.cwd(), '.verify');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
if (!page) throw new Error('没有可用的页面目标（浏览器是否在 9222 上监听？）');

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
  await sleep(15);
  for (let i = 1; i <= 14; i += 1) {
    await mouse(
      'mouseMoved',
      from.x + ((to.x - from.x) * i) / 14,
      from.y + ((to.y - from.y) * i) / 14,
    );
    await sleep(8);
  }
  await mouse('mouseReleased', to.x, to.y);
  await sleep(150);
}

const handleAt = (index, side) =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const r = nodes[${index}].querySelector('.react-flow__handle-${side}').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);

/** 世界坐标几何 + 连线穿节点采样检测（与 e2e-layout-edges 同一判据）。 */
const audit = () =>
  asJson(`(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((el, index) => {
      const match = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(el.style.transform);
      return { index, label: el.textContent.trim(), x: Number(match[1]), y: Number(match[2]),
               w: Number.parseFloat(el.style.width), h: Number.parseFloat(el.style.height) };
    });
    const INSET = 3, ENDPOINT_SKIP = 8, STEPS = 140;
    const crossings = [];
    [...document.querySelectorAll('.react-flow__edge-path')].forEach((path, index) => {
      const total = path.getTotalLength();
      let hits = 0;
      const hitNodes = new Set();
      for (let i = 0; i <= STEPS; i += 1) {
        const travelled = (total * i) / STEPS;
        if (travelled < ENDPOINT_SKIP || total - travelled < ENDPOINT_SKIP) continue;
        const point = path.getPointAtLength(travelled);
        for (const node of nodes) {
          if (point.x > node.x + INSET && point.x < node.x + node.w - INSET &&
              point.y > node.y + INSET && point.y < node.y + node.h - INSET) {
            hits += 1;
            hitNodes.add(node.label + '#' + node.index);
          }
        }
      }
      if (hits > 0) crossings.push({ edge: index + 1, hits, nodes: [...hitNodes] });
    });
    return JSON.stringify({ nodes: nodes.length, crossings });
  })()`);

const grid = () =>
  asJson(`(() => {
    const items = [...document.querySelectorAll('ul > li')];
    const flow = document.querySelector('.react-flow').getBoundingClientRect();
    return JSON.stringify({
      items: items.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }),
      canvas: { left: flow.left, top: flow.top },
    });
  })()`);

/**
 * 前置自检：界面结构一变，脚本就会去测不存在的东西。与其输出一份"看着正常其实无意义"的报告，
 * 不如直接报错退出——这是本脚本不腐烂的前提（见 AGENTS.md「已踩过的坑」）。
 */
async function preflight() {
  const probe = await asJson(`(() => {
    const items = [...document.querySelectorAll('ul > li')];
    const layoutButton = [...document.querySelectorAll('button')]
      .some((b) => b.textContent.trim() === '整理布局');
    return JSON.stringify({
      paletteItems: items.length,
      layoutButton,
      canvas: Boolean(document.querySelector('.react-flow')),
    });
  })()`);

  const problems = [];
  if (probe.paletteItems < 5) problems.push(`图形库条目只有 ${probe.paletteItems} 个（期望 ≥5）`);
  if (!probe.layoutButton) problems.push('找不到「整理布局」按钮');
  if (!probe.canvas) problems.push('找不到 .react-flow 画布');
  if (problems.length > 0) {
    console.error('\n诊断脚本已过期，先更新它再运行：');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(2);
  }
}

/**
 * 每个用例：nodes 是图形库下标，edges 是 [源下标, 目标下标, 源锚点, 目标锚点]。
 * 锚点故意选得"方位未必正确"，交给布局去重挑——这正是我们现在的行为。
 */
const CASES = [
  {
    name: 'A. 跨两层，中间层节点与目标同列',
    nodes: [0, 1, 4], // 处理 / 圆角矩形 / 起止
    edges: [
      [0, 1, 'bottom', 'top'],
      [1, 2, 'bottom', 'top'],
      [0, 2, 'bottom', 'top'], // 处理 → 起止，跨两层
    ],
    note: '处理→开始 直接跳层，中间层的"步骤"若与"开始"同列就会挡路',
  },
  {
    name: 'B. 跨三层，中间层有两级节点',
    nodes: [0, 1, 1, 4], // 处理 / 步骤 / 步骤 / 起止
    edges: [
      [0, 1, 'bottom', 'top'],
      [1, 2, 'bottom', 'top'],
      [2, 3, 'bottom', 'top'],
      [0, 3, 'bottom', 'top'], // 处理 → 起止，跨三层
    ],
    note: '长边要穿过两个中间层节点所在的列',
  },
  {
    name: 'C. 菱形（全部为相邻层边）',
    nodes: [0, 1, 1, 4],
    edges: [
      [0, 1, 'right', 'left'],
      [0, 2, 'bottom', 'top'],
      [1, 3, 'bottom', 'top'],
      [2, 3, 'right', 'left'],
    ],
    note: '对照组：每条边只跨一层，预期不穿越',
  },
  {
    name: 'D. 跨两层，但目标被两个父节点夹在中间',
    nodes: [0, 1, 2, 3], // 处理 / 步骤 / 判断 / 输入输出
    edges: [
      [0, 1, 'bottom', 'top'],
      [0, 2, 'bottom', 'top'],
      [1, 3, 'bottom', 'top'],
      [2, 3, 'bottom', 'top'],
      [0, 3, 'bottom', 'top'], // 处理 → 输入输出，跨两层
    ],
    note: '对照组：目标是同层两个孩子的中点，长边的竖直段应当落在空隙里',
  },
];

await send('Page.enable');
await send('Runtime.enable');
await mkdir(OUT_DIR, { recursive: true });

// 先加载一次页面做前置自检，再进入用例循环
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1200);
await preflight();

const results = [];

for (const item of CASES) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1200);
  const layoutGrid = await grid();

  // 把节点散开摆：一行三个 / 两行两个
  const spots = item.nodes.map((_, index) => ({
    x: layoutGrid.canvas.left + 180 + (index % 3) * 230,
    y: layoutGrid.canvas.top + 90 + Math.floor(index / 3) * 170,
  }));

  for (let index = 0; index < item.nodes.length; index += 1) {
    await drag(layoutGrid.items[item.nodes[index]], spots[index]);
  }
  for (const [from, to, fromHandle, toHandle] of item.edges) {
    await drag(await handleAt(from, fromHandle), await handleAt(to, toHandle));
  }

  const beforeEdges = await evaluate(`document.querySelectorAll('.react-flow__edge').length`);

  await evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局').click();
    return 'ok';
  })()`);
  await sleep(600);

  const after = await audit();
  results.push({
    ...item,
    edgesBuilt: beforeEdges,
    // 连线没连够说明用例构造失败，结果无意义——必须标出来，不能当成"未触发"
    valid: beforeEdges === item.edges.length,
    crossingEdges: after.crossings,
  });
}

console.log('\n================ 残留问题量化：线穿过第三个节点 ================\n');
for (const item of results) {
  console.log(`${item.name}`);
  if (!item.valid) {
    console.log(`  ⚠️ 用例构造失败：只连上 ${item.edgesBuilt}/${item.edges.length} 条线，结果无效`);
    console.log(`  说明：${item.note}\n`);
    continue;
  }
  const total = item.crossingEdges.length;
  const detail = total
    ? item.crossingEdges
        .map((c) => `第 ${c.edge} 条线穿 ${c.nodes.join('/')}（${c.hits} 个采样点）`)
        .join('；')
    : '无穿越';
  console.log(
    `  节点 ${item.nodes.length} 个，连线 ${item.edgesBuilt} 条 → ${total ? '⚠️ 触发' : '✅ 未触发'}`,
  );
  console.log(`  ${detail}`);
  console.log(`  说明：${item.note}\n`);
}

const invalid = results.filter((item) => !item.valid);
const valid = results.filter((item) => item.valid);
const triggered = valid.filter((item) => item.crossingEdges.length > 0);
console.log('================ 汇总 ================');
console.log(
  `构造的 ${valid.length} 种有效结构里，${triggered.length} 种触发了"线穿过第三个节点"：`,
);
for (const item of triggered) console.log(`  - ${item.name}`);
if (invalid.length > 0) {
  console.log(`另有 ${invalid.length} 个用例构造失败、结果无效（请先修脚本）：`);
  for (const item of invalid)
    console.log(`  - ${item.name}（连线 ${item.edgesBuilt}/${item.edges.length}）`);
}
console.log('');

ws.close();
server.close();
process.exit(0);
