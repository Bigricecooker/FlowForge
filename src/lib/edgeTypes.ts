/** 连线样式。对外用直观名字，落到 React Flow 时再映射（它的贝塞尔边型叫 `default`）。 */
export type EdgeType = 'smoothstep' | 'bezier' | 'straight';

export interface EdgeTypeOption {
  value: EdgeType;
  label: string;
  hint: string;
}

export const EDGE_TYPES: readonly EdgeTypeOption[] = [
  { value: 'smoothstep', label: '折线', hint: '正交折线，拐角带圆角（默认）' },
  { value: 'bezier', label: '曲线', hint: '平滑贝塞尔曲线' },
  { value: 'straight', label: '直线', hint: '两端直连' },
];

/**
 * 落到 React Flow 的边型名。三种线型**全部**使用"智能避障"变体：
 * 内置边只看两个端点、不感知其他节点，跨层边会径直穿过中间层的节点
 * （诊断实测：4 种结构里 3 种触发，只要存在跨 ≥2 层的边就大概率穿）。
 * 智能边用网格 A* 寻路，被挡时才绕；直线本来就通畅的边走原生路径，开销可忽略。
 * 组件注册表在 `components/canvas/FlowCanvas.tsx`（模块作用域）。
 */
const SMART_EDGE_TYPES: Record<EdgeType, string> = {
  smoothstep: 'smart-smoothstep',
  bezier: 'smart-bezier',
  straight: 'smart-straight',
};

export function toFlowEdgeType(edgeType: EdgeType): string {
  return SMART_EDGE_TYPES[edgeType];
}

/**
 * 箭头颜色。marker 由 React Flow 以行内 style 上色，因此这里可以直接用主题变量。
 * 线条颜色走 --xy-edge-stroke（见 FlowCanvas.module.css），选中态可被 CSS 覆盖。
 */
export const EDGE_MARKER_COLOR = 'var(--edge)';
