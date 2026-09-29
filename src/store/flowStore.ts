import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { EdgeChange, NodeChange, OnConnect, XYPosition } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { getShapeDef } from '../components/palette/shapeDefs';
import type { ShapeKind } from '../components/palette/shapeDefs';
import { toFlowEdgeType } from '../lib/edgeTypes';
import type { EdgeType } from '../lib/edgeTypes';
import type { FlowEdge, FlowNode } from './types';

interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 当前连线样式。刻意放在文档状态里：新建连线写入它，切换时同步改写已有连线。 */
  edgeType: EdgeType;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  onConnect: OnConnect;
  setEdgeType: (edgeType: EdgeType) => void;
  /** 在给定世界坐标处新建节点，坐标代表节点中心。 */
  addNode: (kind: ShapeKind, center: XYPosition) => void;
}

/**
 * 文档状态：节点、连线与连线样式。
 * 连线样式不依赖 React Flow 的 defaultEdgeOptions：后者只影响首次挂载后的新边，
 * 已经渲染出来的边不会跟着变，所以这里显式写进每条边。
 */
export const useFlowStore = create<FlowState>((set) => ({
  nodes: [],
  edges: [],
  edgeType: 'smoothstep',

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge(
        { ...connection, id: nanoid(8), type: toFlowEdgeType(state.edgeType) },
        state.edges,
      ),
    })),

  setEdgeType: (edgeType) =>
    set((state) => ({
      edgeType,
      edges: state.edges.map((edge) => ({ ...edge, type: toFlowEdgeType(edgeType) })),
    })),

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
