/**
 * 生成 `THIRD-PARTY-NOTICES.md`：列出随产物分发的运行时依赖及其许可。
 *
 * 为什么用生成而不是手写：手写的致谢清单一定会过期（加了依赖忘了补、升了版本没改）。
 * 本脚本从 `package.json` 的 `dependencies` 出发，递归读 `node_modules` 下各包的 package.json
 * 取真实的 name / version / license / author / repository，所以它永远和实际依赖一致。
 *
 * 范围：只覆盖 `dependencies`（= 会被打进 `dist/` 的运行时依赖，含传递依赖）。
 * 开发依赖（Vite / TypeScript / ESLint / Prettier 等）不随产物分发，因此不列入。
 *
 * 用法：npm run notices
 *
 * 注意：本文件仍**不包含各依赖的完整许可文本**。当前是源码仓库，指向各组件仓库即可；
 * 等 Electron 打包分发时，必须重新生成并把完整许可文本一并附上（打包阶段的任务）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'package.json');
const OUTPUT = join(ROOT, 'THIRD-PARTY-NOTICES.md');

/** 读一个包的 package.json；读不到返回 null。 */
function readPackage(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** npm 会把依赖提升到根 node_modules，找不到再往上层尝试。 */
function resolvePackageDir(name) {
  const segments = name.startsWith('@') ? name.split('/') : [name];
  let current = ROOT;
  for (;;) {
    const candidate = join(current, 'node_modules', ...segments);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 从某个包目录出发解析它自己声明的依赖（优先就近的嵌套 node_modules）。 */
function resolveFrom(packageDir, name) {
  const segments = name.startsWith('@') ? name.split('/') : [name];
  let current = packageDir;
  for (;;) {
    const candidate = join(current, 'node_modules', ...segments);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const collected = new Map();

function collect(name, fromDir) {
  if (collected.has(name)) return;
  const dir =
    fromDir === null
      ? resolvePackageDir(name)
      : (resolveFrom(fromDir, name) ?? resolvePackageDir(name));
  if (dir === null) {
    collected.set(name, null);
    return;
  }
  const manifest = readPackage(dir);
  if (manifest === null) {
    collected.set(name, null);
    return;
  }
  collected.set(name, { dir, manifest });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    collect(dependency, dir);
  }
}

const root = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const name of Object.keys(root.dependencies ?? {})) {
  collect(name, null);
}

const authorOf = (manifest) => {
  const author = manifest.author;
  if (typeof author === 'string')
    return author
      .replace(/\s*<[^>]*>/, '')
      .replace(/\s*\([^)]*\)/, '')
      .trim();
  if (author && typeof author === 'object' && author.name) return author.name;
  const contributors = manifest.contributors;
  if (Array.isArray(contributors) && contributors.length > 0) {
    const first = contributors[0];
    return typeof first === 'string' ? first : (first?.name ?? '');
  }
  return '';
};

const repoOf = (manifest) => {
  const repository = manifest.repository;
  const raw = (typeof repository === 'string' ? repository : (repository?.url ?? '')).trim();
  if (raw === '') return '';
  const url = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/');
  // 有些包把仓库写成 `owner/name` 简写，补成完整地址
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url;
};

const rows = [];
const missing = [];
for (const [name, entry] of collected) {
  if (entry === null) {
    missing.push(name);
    continue;
  }
  const { manifest } = entry;
  const license =
    typeof manifest.license === 'string'
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses
            .map((item) => item.type ?? '')
            .filter(Boolean)
            .join(' OR ')
        : '(未声明)';
  rows.push({
    name,
    version: manifest.version ?? '?',
    license,
    author: authorOf(manifest),
    repo: repoOf(manifest),
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const byLicense = new Map();
for (const row of rows) byLicense.set(row.license, (byLicense.get(row.license) ?? 0) + 1);

const lines = [
  '# 第三方组件致谢',
  '',
  '本项目的产物包含下列开源组件。**本文件由 `npm run notices` 生成，请勿手工编辑**——',
  '它从 `package.json` 的 `dependencies` 出发递归读取各包的真实元数据，因此不会过期。',
  '',
  `覆盖范围：随产物分发的运行时依赖及其传递依赖，共 **${rows.length}** 个（开发依赖不随产物分发，未列入）。`,
  '',
  '许可分布：' +
    [...byLicense.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} × ${v}`)
      .join('、'),
  '',
  '| 组件 | 版本 | 许可 | 作者 / 维护者 | 仓库 |',
  '|---|---|---|---|---|',
  ...rows.map(
    (row) =>
      `| [${row.name}](https://www.npmjs.com/package/${row.name}) | ${row.version} | ${row.license} | ${row.author || '—'} | ${row.repo ? `<${row.repo}>` : '—'} |`,
  ),
  '',
  '## 说明',
  '',
  '- 上表列出的是**声明信息**。每个组件的完整许可文本随其包分发，位于',
  '  `node_modules/<组件名>/LICENSE*`，也可在各组件仓库中查看。',
  '- **当前是源码仓库**，因此以指向各组件仓库为主。',
  '- **Electron 打包分发之前必须重新生成本文件，并把各依赖的完整许可文本一并附入安装包**',
  '  ——这是打包阶段的任务，不能省。',
  '',
];

if (missing.length > 0) {
  lines.push(
    `> ⚠️ 有 ${missing.length} 个依赖没能在 node_modules 里解析到：${missing.join('、')}`,
    '',
  );
}

writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
console.log(`已生成 ${OUTPUT}`);
console.log(
  `  组件 ${rows.length} 个，许可分布：${[...byLicense.entries()].map(([k, v]) => `${k} × ${v}`).join('、')}`,
);
if (missing.length > 0) console.log(`  未解析到：${missing.join('、')}`);
