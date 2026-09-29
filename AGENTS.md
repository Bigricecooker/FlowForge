# AGENTS.md

给 AI 编码代理的工作手册，每次会话自动读入。目的是**让新会话不必重新问一遍"我们定过什么"**。

写法原则（改本文件时同样适用）：

- 只写**必须知道、且从代码里读不出来**的东西：不变量、踩过的坑、协作方式
- 能被代码或提交历史回答的，**用指针代替复制**（见「真相在哪」）
- 每条约束保留时间限定词（"当前""后置"），不要压缩成永久禁令

## 项目

FlowForge —— 图表（流程图）桌面绘制软件。左图形库、中画布、右暂留区（将来接 AI）、底部状态栏；
浅色基调；交互为拖拽式绘图 + 箭头连线。

技术栈：Vite 8 · React 19 · TypeScript 6 · @xyflow/react 12 · zustand 5 · dagre · CSS Modules（配 CSS 变量）· Electron（最后阶段接入）

## 命令

```bash
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint     # ESLint
npm run format   # Prettier
```

## 硬约束

每条都来自"用户拍板的取舍"或"踩坑后确认的结论"。既不是永久禁令，也不该被顺手改掉——
要改先说明理由并征得确认。

### 样式

- 颜色、尺寸、圆角、字号只从 `src/styles/tokens.css` 取，组件里不写死色值
- 当前是 CSS Modules + 手写组件，**未引入 UI 组件库 ≠ 禁止引入**。真需要复杂基础件
  （表格、树、虚拟滚动、日期选择、大量弹层/下拉）时可以引入，但要先确认，并处理两个已知影响：
  1. **组件库的全局 reset 会动盒模型**，而 React Flow 的锚点位置直接决定连线端点——
     引入后必须重跑端到端验证确认端点仍吸附。端点是按锚点**外沿**算的：默认 6px 锚点
     意味着端点落在节点边缘外 3px，锚点盒模型一变，端点位置就跟着偏
  2. **把库的主题变量映射到本项目 token**，否则画布内外两套视觉语言

  引入属于**局部替换**（只涉及按钮、面板、浮层这类基础件），画布、store、图形定义不受牵连
- 与 React Flow 的视觉对接走它自己的 CSS 变量（`--xy-edge-stroke`、`--xy-edge-stroke-selected`、
  `--xy-handle-*`、`--xy-connectionline-*`），不要用选择器去和它的默认样式拼优先级

### 画布与连线

- 连线**当前**只用库内置能力（smoothstep / bezier / straight）。自研连线几何（按方位自动选锚点、
  出线桩调优、平行边偏移、自环美化、A\* 绕障）是用户明确**后置**的项，不是禁止
- 线型必须写进每条边（`edge.type`）：React Flow 的 `defaultEdgeOptions` 变更**不会**传导到已渲染的边，
  只影响之后新建的边
- 库把贝塞尔边注册在 `default` 名下，**没有 `bezier` 这个边型**；对外名字经 `toFlowEdgeType()` 转换
- 节点尺寸写死在 `shapeDefs.ts`，不要依赖首帧测量：测量为空会让连线端点算成 `NaN`，
  且自动布局需要确切尺寸
- 锚点保持库默认尺寸（6px）：库按锚点**外沿**计算连线端点，放大锚点会让端点跟着外移；
  要好点就用 `::after` 撑命中区，不要改盒模型

### 状态分层

- `flowStore` = 文档（节点、连线、线型、剪贴板）；`viewStore` = 视口与光标；`dragStore` = 拖拽态
- 视口、光标、拖拽态**不进文档状态**，否则将来的撤销栈会被平移缩放塞满
- 选中态不单独存：React Flow 会把 `selected` 写回节点/连线对象，过滤即可
- 删除只走 `flowStore.deleteSelection()` 一条路径；`deleteKeyCode` 已置 `null`，不要重新打开，
  否则删除双写、撤销无法统一记录
- 暂留区的面板开关是纯界面状态，且只被那一个子树使用 → 留在组件本地 state，
  不进 store、也不进撤销栈

### 功能边界

- 保存/打开、导入导出、暗色主题均为**后置项**，等明确要求再加
- 暂留区是**面板宿主**：谁能出现在这里完全由 `components/inspector/panels.tsx` 的注册表决定，
  新增一个界面 = 加一条注册项，布局代码不用动
- 面板**一次只显示一个**（分页，不是分栏）；顶栏分页在点过控件栏之后才出现
- 右侧控件栏固定宽度、不可折叠；当前只有「节点属性」一个面板，属性只读且所有图形相同

## 代码地图

回答"想改 X 该去哪个文件"，不是目录清单。

| 想改什么 | 去哪 |
|---|---|
| 图形种类、默认尺寸与文案 | `src/components/palette/shapeDefs.ts`（尺寸的唯一定义源） |
| 设计变量（颜色 / 间距 / 字号 / 圆角） | `src/styles/tokens.css`；组件只读 `var(--x)` |
| 三栏布局、面板宽度、分隔条 | `components/layout/AppShell.tsx`、`ResizableSplitter.tsx` |
| 状态栏显示哪些项 | `layout/StatusBar.tsx`（纯展示）；数据在 `layout/AppShell.tsx` 订阅注入 |
| 拖拽落图、快捷键、React Flow 配置 | `components/canvas/FlowCanvas.tsx` |
| 节点外形、锚点、内联改名 | `components/canvas/nodes/FlowNode.tsx`、`NodeShape.tsx` |
| 节点/连线的增删改、剪贴板 | `src/store/flowStore.ts` |
| 边型定义与名字映射 | `src/lib/edgeTypes.ts` |
| 一键自动布局（dagre） | `src/lib/autoLayout.ts`（纯函数）；按钮与 fitView 在 `components/canvas/FlowCanvas.tsx` |
| 快捷键浮层的文案内容 | `src/lib/shortcuts.ts`（单一数据源） |
| 暂留区容器（顶栏分页 + 面板宿主） | `components/inspector/ReservedArea.tsx` |
| **新增一个暂留区界面** | `components/inspector/panels.tsx`（注册表加一条即可） |
| 右侧控件栏 | `components/inspector/PanelRail.tsx` |
| 节点属性面板 | `components/inspector/NodePropertiesPanel.tsx` |

## 已踩过的坑

遇到类似症状先查这里，别再重新排查一遍。

| 现象 | 根因与结论 |
|---|---|
| 切换边型后画布毫无变化 | `defaultEdgeOptions` 不传导到已渲染的边 → 线型写进 `edge.type` |
| 边型 `bezier` 落到未知类型 | 库把贝塞尔边注册在 `default` 名下 |
| 连线端点落在锚点中心之外 3px | 库按锚点**外沿**算端点，放大锚点端点就外移 → 保持默认 6px |
| E2E 里 `Ctrl+C/V` 无反应 | CDP 传 `nativeVirtualKeyCode` 时 Chrome 把它当浏览器编辑命令拦截，页面收不到 keydown |

## 工作方式

以下是当前协作习惯，**不是规定**，随时可以调整。

- 按里程碑推进，**一个阶段一次提交**；提交信息用中文，标题一行 + 要点列表
- 每阶段收尾依次跑：`npx tsc -b` → `npm run lint` → `npm run build` → 端到端验证
- 端到端验证用 CDP 驱动 headless Chrome 做**真实交互**（真拖拽、真按键），不要写"只断言 DOM 存在"的假验证
- 报告结论必须给实测数字（偏差多少像素、几项通过），不要只说"已实现"
- 遇到测试失败先分清是产品缺陷还是测试脚本问题，必要时写对照脚本证明

## 真相在哪

**不复制真相，只指向真相**——否则文档迟早和代码各说一套：

| 想知道 | 看哪 |
|---|---|
| 做到哪一步了 | `git log`（一阶段一提交，提交信息含要点与验收结论） |
| 设计变量取值 | `src/styles/tokens.css` |
| 图形的尺寸与文案 | `src/components/palette/shapeDefs.ts` |
| 快捷键有哪些 | `src/lib/shortcuts.ts` |
