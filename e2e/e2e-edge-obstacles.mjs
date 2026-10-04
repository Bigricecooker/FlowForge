/**
 * 智能边避障回归：真实拖拽构造跨层连线，整理布局后检测路径是否穿过节点。
 * A/B/D 是跨层案例，C 是相邻层对照。每条边沿 SVG 长度采样，节点内部内缩 3px，
 * 连线两端 8px 不计；建图不完整、路径缺失或任一穿越均使场景失败。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
const report = [];
function record(label, ok, detail) {
  report.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
}

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
    const paths = [...document.querySelectorAll('.react-flow__edge-path')].map((path, index) => {
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
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(total);
      return { length: total, d: path.getAttribute('d'), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
    });
    return JSON.stringify({ nodes, paths, crossings });
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
 * 前置自检：界面结构一变，不能把空结果当成没有穿越。
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
    console.error('\n避障回归无法构造用例，先更新脚本：');
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
    longEdge: 2,
    edges: [
      [0, 1, 'bottom', 'top'],
      [1, 2, 'bottom', 'top'],
      [0, 2, 'bottom', 'top'], // 处理 → 起止，跨两层
    ],
  },
  {
    name: 'B. 跨三层，中间层有两级节点',
    nodes: [0, 1, 1, 4], // 处理 / 步骤 / 步骤 / 起止
    longEdge: 3,
    edges: [
      [0, 1, 'bottom', 'top'],
      [1, 2, 'bottom', 'top'],
      [2, 3, 'bottom', 'top'],
      [0, 3, 'bottom', 'top'], // 处理 → 起止，跨三层
    ],
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
  },
  {
    name: 'D. 跨两层，但目标被两个父节点夹在中间',
    nodes: [0, 1, 2, 3], // 处理 / 步骤 / 判断 / 输入输出
    longEdge: 4,
    edges: [
      [0, 1, 'bottom', 'top'],
      [0, 2, 'bottom', 'top'],
      [1, 3, 'bottom', 'top'],
      [2, 3, 'bottom', 'top'],
      [0, 3, 'bottom', 'top'], // 处理 → 输入输出，跨两层
    ],
  },
];

/** 校验案例 A/B 的原始两端点直连确实会碰到中间节点，防止布局变化让断言空转。 */
function straightHitNodes(path, nodes) {
  if (!path) return [];
  return nodes
    .slice(1, -1)
    .filter((node) => {
      for (let index = 0; index <= 140; index += 1) {
        const fraction = index / 140;
        const x = path.start.x + (path.end.x - path.start.x) * fraction;
        const y = path.start.y + (path.end.y - path.start.y) * fraction;
        if (x > node.x + 3 && x < node.x + node.w - 3 && y > node.y + 3 && y < node.y + node.h - 3)
          return true;
      }
      return false;
    })
    .map((node) => node.index);
}

await send('Page.enable');
await send('Runtime.enable');
await mkdir(OUT_DIR, { recursive: true });

// 先加载一次页面做前置自检，再进入用例循环
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1200);
await preflight();

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

  const beforeNodes = await evaluate(`document.querySelectorAll('.react-flow__node').length`);
  const beforeEdges = await evaluate(`document.querySelectorAll('.react-flow__edge').length`);
  record(
    `${item.name}：节点和连线构造完整`,
    beforeNodes === item.nodes.length && beforeEdges === item.edges.length,
    `节点 ${beforeNodes}/${item.nodes.length}，连线 ${beforeEdges}/${item.edges.length}`,
  );

  await evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '整理布局').click();
    return 'ok';
  })()`);
  // 智能边在 Worker 中异步绕行；等待路径替换与 fitView 动画完成。
  await sleep(700);

  const after = await audit();
  record(
    `${item.name}：每条连线均有可采样路径`,
    after.paths.length === item.edges.length &&
      after.paths.every(
        (path) => Number.isFinite(path.length) && path.length > 16 && Boolean(path.d),
      ),
    `路径 ${after.paths.length}/${item.edges.length}，长度 ${after.paths.map((path) => Math.round(path.length)).join('/') || '无'}px`,
  );
  if (item.name[0] !== 'C') {
    const from = after.nodes[0];
    const to = after.nodes[after.nodes.length - 1];
    const middle = after.nodes.slice(1, -1);
    const fromY = from.y + from.h / 2;
    const toY = to.y + to.h / 2;
    record(
      `${item.name}：长边确实跨过中间层`,
      fromY < toY &&
        middle.every((node) => {
          const centerY = node.y + node.h / 2;
          return fromY < centerY && centerY < toY;
        }),
      `起点 y=${Math.round(fromY)}，中间层 y=${middle.map((node) => Math.round(node.y + node.h / 2)).join('/')}，终点 y=${Math.round(toY)}`,
    );
  }
  if (item.name[0] === 'A' || item.name[0] === 'B') {
    const hitNodes = straightHitNodes(after.paths[item.longEdge], after.nodes);
    record(
      `${item.name}：直连基线确实会撞到中间节点`,
      hitNodes.length === after.nodes.length - 2,
      `直连会穿过 ${hitNodes.length}/${after.nodes.length - 2} 个中间节点`,
    );
  }
  record(
    `${item.name}：布局后所有连线零穿越`,
    after.paths.length === item.edges.length && after.crossings.length === 0,
    after.crossings.length
      ? after.crossings
          .map(
            (crossing) =>
              `第 ${crossing.edge} 条线穿过 ${crossing.nodes.join('/')}（${crossing.hits} 个采样点）`,
          )
          .join('；')
      : `检查 ${after.paths.length} 条路径，每条 141 个采样点，穿越 0`,
  );

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    join(OUT_DIR, `m8-obstacles-${item.name[0].toLowerCase()}.png`),
    Buffer.from(screenshot.data, 'base64'),
  );
}

const failed = report.filter((item) => !item.ok);
console.log(`\n结果：${report.length - failed.length}/${report.length} 通过`);

ws.close();
server.close();
process.exit(failed.length === 0 ? 0 : 1);
