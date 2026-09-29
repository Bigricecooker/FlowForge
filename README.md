# FlowForge

图表桌面绘制软件：左侧图形库、中间画布、右侧暂留区（布局参考 VS Code，浅色基调）。

## 开发

```bash
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run lint     # ESLint
npm run format   # Prettier 格式化
```

## 技术栈

- React 19 + TypeScript + Vite
- 画布引擎：[@xyflow/react](https://reactflow.dev)（React Flow v12）
- 状态：zustand；id：nanoid；自动布局：dagre
- 样式：CSS 变量（`src/styles/tokens.css`）+ CSS Modules，不引 UI 组件库
- 桌面壳：Electron（最后阶段接入）

## 目录

```
src/
  components/
    layout/     三栏骨架、分隔条、状态栏
    palette/    左侧图形库与图形定义
    canvas/     画布区域
    inspector/  右侧暂留区
    help/       快捷键浮层
  lib/          快捷键表等无 UI 逻辑
  styles/       设计变量与全局样式
```
