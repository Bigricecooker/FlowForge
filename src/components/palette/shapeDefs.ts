/** 流程图基础图形的唯一定义源：图形库列表、节点渲染、拖拽落图都读这里。 */
export type ShapeKind = 'process' | 'rounded' | 'decision' | 'io' | 'terminator';

export interface ShapeDef {
  kind: ShapeKind;
  /** 图形库中显示的名称。 */
  label: string;
  /** 新建节点时的默认文字。 */
  defaultText: string;
  /** 世界坐标下的固定尺寸，供连线端点计算与自动布局使用。 */
  width: number;
  height: number;
}

export const SHAPE_DEFS: readonly ShapeDef[] = [
  { kind: 'process', label: '处理', defaultText: '处理', width: 160, height: 56 },
  { kind: 'rounded', label: '圆角矩形', defaultText: '步骤', width: 160, height: 56 },
  { kind: 'decision', label: '判断', defaultText: '条件？', width: 140, height: 80 },
  { kind: 'io', label: '输入/输出', defaultText: '输入输出', width: 160, height: 56 },
  { kind: 'terminator', label: '起止', defaultText: '开始', width: 120, height: 56 },
];

export function getShapeDef(kind: ShapeKind): ShapeDef {
  const def = SHAPE_DEFS.find((item) => item.kind === kind);
  if (!def) throw new Error(`未知图形类型：${kind}`);
  return def;
}
