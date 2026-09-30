/**
 * 回归测试入口：依次跑 e2e/ 下所有 `e2e-*.mjs` 场景，最后汇总。
 *
 * 每个场景自己会：
 *   - 起一个静态服务托管 `dist/`（各自用不同端口，顺序执行不冲突）
 *   - 通过 CDP 驱动 headless Chrome 做**真实交互**（真拖拽、真按键），而不是只断言 DOM 存在
 *   - 把截图写到 `.verify/`（该目录被 gitignore）
 *
 * 前置：
 *   - `dist/` 需要是当前代码构建出来的。本脚本默认先跑一次 `npm run build`；
 *     若外面已经构建好，可用 `SKIP_BUILD=1` 跳过（沙箱里构建需要提权，通常这样用）。
 *   - 需要一个可被 CDP 驱动的浏览器。脚本先探测 127.0.0.1:9222；若没有监听，
 *     就自己拉一个 headless 实例；可以用 `CHROME_PATH` 指定 chrome.exe / msedge.exe。
 *
 * 用法：
 *   npm run e2e                 # 构建 + 跑全部场景
 *   SKIP_BUILD=1 npm run e2e    # 跳过构建
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const E2E_DIR = join(ROOT, 'e2e');
const ARTIFACTS = join(ROOT, '.verify');
const CDP_PORT = 9222;
const CDP_VERSION_URL = `http://127.0.0.1:${CDP_PORT}/json/version`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpAlive() {
  try {
    const response = await fetch(CDP_VERSION_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpAlive()) return true;
    await sleep(300);
  }
  return false;
}

/** 通过 CDP 让浏览器自己退出（比 kill 干净）。 */
async function closeBrowser() {
  const version = await (await fetch(CDP_VERSION_URL)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  await sleep(500);
}

let launchedBrowser = false;

async function ensureBrowser() {
  if (await cdpAlive()) {
    console.log(`[e2e] 复用已监听 ${CDP_PORT} 端口的浏览器`);
    return;
  }

  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (executable === undefined) {
    throw new Error('找不到浏览器：请设置 CHROME_PATH 指向 chrome.exe 或 msedge.exe');
  }

  mkdirSync(ARTIFACTS, { recursive: true });
  spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1440,900',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(ARTIFACTS, 'chrome-cdp')}`,
      'about:blank',
    ],
    // stdio 用 ignore：某些受限环境下带管道的 spawn 会被拒绝
    { stdio: 'ignore' },
  );
  launchedBrowser = true;

  if (!(await waitForCdp())) throw new Error('浏览器已启动，但 CDP 端口一直没就绪');
  console.log(`[e2e] 已启动浏览器：${executable}`);
}

function build() {
  if (process.env.SKIP_BUILD === '1') {
    console.log('[e2e] 跳过构建（SKIP_BUILD=1）');
    return true;
  }
  console.log('[e2e] 构建产物 …');
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
  return result.status === 0;
}

async function main() {
  if (!build()) {
    console.error('[e2e] 构建失败，终止');
    process.exit(1);
  }

  await ensureBrowser();

  const scenarios = readdirSync(E2E_DIR)
    .filter((name) => /^e2e-.*\.mjs$/.test(name))
    .sort();
  if (scenarios.length === 0) {
    console.error('[e2e] e2e/ 下没有找到任何场景');
    process.exit(1);
  }

  const results = [];
  for (const name of scenarios) {
    const started = Date.now();
    console.log(`\n[e2e] ▶ ${name}`);
    const result = spawnSync(process.execPath, [join(E2E_DIR, name)], { stdio: 'inherit' });
    results.push({ name, code: result.status ?? 1, ms: Date.now() - started });
  }

  console.log('\n[e2e] ==== 汇总 ====');
  for (const item of results) {
    const mark = item.code === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${item.name}  (${(item.ms / 1000).toFixed(1)}s)`);
  }
  const failed = results.filter((item) => item.code !== 0);
  console.log(`[e2e] ${results.length - failed.length}/${results.length} 个场景通过`);

  if (launchedBrowser) await closeBrowser().catch(() => {});
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
