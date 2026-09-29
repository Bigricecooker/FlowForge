import type { Edge, Node } from '@xyflow/react';

import type { ShapeKind } from '../components/palette/shapeDefs';

/** 节点业务数据。用 type 而非 interface：React Flow 要求可索引的对象类型。 */
export type FlowNodeData = {
  kind: ShapeKind;
  label: string;
};

export type FlowNode = Node<FlowNodeData, 'flow'>;
export type FlowEdge = Edge;
