# FlowForge

图表桌面绘制软件：左侧图形库、中间画布、右侧暂留区（布局参考 VS Code，浅色基调）。

## 开发

```bash
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run lint     # ESLint
npm run format   # Prettier 格式化
npm run e2e      # 端到端回归（会先构建；SKIP_BUILD=1 跳过构建）
npm run notices  # 重新生成 THIRD-PARTY-NOTICES.md（加/删依赖后要跑）
```

> `npm run e2e` 用 CDP 驱动 headless Chrome 做**真实交互**（真拖拽、真按键、真缩放），
> 并断言**实测数值**（偏差多少像素、几项通过），不是"只断言 DOM 存在"的假验证。

## 技术栈

| 分层     | 选型                                                                               | 作用                                     |
| -------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| 界面     | React 19 · TypeScript 6                                                            | 手写组件，不用 class 组件                |
| 构建     | Vite 8                                                                             | 开发服务器与生产构建                     |
| 画布     | [@xyflow/react](https://reactflow.dev) 12（React Flow）                            | 节点/连线渲染、交互、视口                |
| 连线路由 | [@tisoap/react-flow-smart-edge](https://github.com/tisoap/react-flow-smart-edge) 5 | 越障路由（网格 A\*，跑在 Web Worker 里） |
| 自动布局 | [dagre](https://github.com/dagrejs/dagre) 0.8                                      | 一键分层排布                             |
| 状态     | [zustand](https://github.com/pmndrs/zustand) 5                                     | 文档 / 视口 / 拖拽三个 store             |
| id 生成  | nanoid 6                                                                           | 节点与连线 id                            |
| 样式     | CSS 变量（`src/styles/tokens.css`）+ CSS Modules                                   | 不引 UI 组件库；颜色与尺寸只从变量取     |
| 代码质量 | ESLint 10 · typescript-eslint · Prettier 3                                         |                                          |
| 回归测试 | 自研 CDP 脚本（`e2e/`，无测试框架）                                                | 真实交互 + 数值断言                      |
| 桌面壳   | Electron                                                                           | **尚未开工**，最后阶段接入               |

## 目录

```
src/
  components/
    layout/     三栏骨架、分隔条、状态栏
    palette/    左侧图形库与图形定义
    canvas/     画布区域（含 nodes/ 节点外形与锚点）
    inspector/  右侧暂留区（面板宿主）
    help/       快捷键浮层
  store/        文档 / 视口 / 拖拽三个 store
  lib/          快捷键表、边型映射、自动布局等无 UI 逻辑
  styles/       设计变量与全局样式
e2e/            端到端回归（npm run e2e）与诊断探针
scripts/        工具脚本（如生成第三方组件致谢）
```

## 架构要点

- **状态分三层**：`flowStore` 文档（节点/连线/线型，进撤销栈）、`viewStore` 视口与光标、
  `dragStore` 拖拽态。**视口、光标、选中态都不进撤销栈**
- **连线几何全部交给库**：三种线型都是智能边，越障由库的 A\* 负责；自研连线几何是后置项
- **暂留区是面板宿主**：谁能出现在那里由 `components/inspector/panels.tsx` 的注册表决定，
  新增一个界面 = 加一条注册项，布局代码不用动
- 更完整的约定、不变量与踩坑记录见 [AGENTS.md](AGENTS.md)

## 许可

本项目以 [MIT 许可](LICENSE) 开源。

## 致谢

本项目建立在许多优秀的开源项目之上。随产物分发的运行时依赖及其传递依赖的完整清单
（组件、版本、许可、作者、仓库）见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，
该文件由 `npm run notices` 从各包的真实元数据生成，不会过期。

其中最关键的几个：

- [React Flow](https://reactflow.dev)（MIT）——画布与连线引擎
- [dagre](https://github.com/dagrejs/dagre)（MIT）——分层自动布局
- [zustand](https://github.com/pmndrs/zustand)（MIT）——状态管理
- [React](https://react.dev)（MIT）——界面框架
