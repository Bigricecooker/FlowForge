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
e2e/            端到端回归（npm run e2e）与诊断探针
scripts/        工具脚本（如生成第三方组件致谢）
```

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
