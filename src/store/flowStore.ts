import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { EdgeChange, NodeChange, XYPosition } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { getShapeDef } from '../components/palette/shapeDefs';
import type { ShapeKind } from '../components/palette/shapeDefs';
import type { FlowEdge, FlowNode } from './types';

interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  /** 在给定世界坐标处新建节点，坐标代表节点中心。 */
  addNode: (kind: ShapeKind, center: XYPosition) => void;
}

/** 文档状态：节点与连线。视口与拖拽态放在各自的 store，避免污染文档。 */
export const useFlowStore = create<FlowState>((set) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  addNode: (kind, center) =>
    set((state) => {
      const def = getShapeDef(kind);
      const node: FlowNode = {
        id: nanoid(8),
        type: 'flow',
        position: { x: center.x - def.width / 2, y: center.y - def.height / 2 },
        data: { kind, label: def.defaultText },
        // 显式尺寸：避免首帧测量为空导致连线端点为 NaN，也让自动布局无需测量
        style: { width: def.width, height: def.height },
      };
      return { nodes: [...state.nodes, node] };
    }),
}));
