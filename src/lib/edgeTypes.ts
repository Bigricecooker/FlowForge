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

/** React Flow 内置边型注册表里，贝塞尔边注册在 `default` 名下，没有 `bezier`。 */
export function toFlowEdgeType(edgeType: EdgeType): string {
  return edgeType === 'bezier' ? 'default' : edgeType;
}

/**
 * 箭头颜色。marker 由 React Flow 以行内 style 上色，因此这里可以直接用主题变量。
 * 线条颜色走 --xy-edge-stroke（见 FlowCanvas.module.css），选中态可被 CSS 覆盖。
 */
export const EDGE_MARKER_COLOR = 'var(--edge)';
