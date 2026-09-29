import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { EdgeChange, NodeChange, OnConnect, XYPosition } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { getShapeDef } from '../components/palette/shapeDefs';
import type { ShapeKind } from '../components/palette/shapeDefs';
import { toFlowEdgeType } from '../lib/edgeTypes';
import type { EdgeType } from '../lib/edgeTypes';
import type { FlowEdge, FlowNode } from './types';

/** 连续粘贴时每粘贴一次的整体位移。 */
const PASTE_OFFSET = 24;

interface Clipboard {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 当前连线样式。刻意放在文档状态里：新建连线写入它，切换时同步改写已有连线。 */
  edgeType: EdgeType;
  /** 复制下来的节点与其内部连线；连续粘贴时这份快照会一起前移。 */
  clipboard: Clipboard | null;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  onConnect: OnConnect;
  setEdgeType: (edgeType: EdgeType) => void;
  /** 在给定世界坐标处新建节点，坐标代表节点中心。 */
  addNode: (kind: ShapeKind, center: XYPosition) => void;
  updateNodeLabel: (id: string, label: string) => void;
  deleteSelection: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  selectAll: () => void;
  clearSelection: () => void;
}

const deselectAll = <T extends { selected?: boolean }>(items: T[]): T[] =>
  items.map((item) => (item.selected ? { ...item, selected: false } : item));

/**
 * 文档状态：节点、连线、连线样式与剪贴板。
 * 连线样式不依赖 React Flow 的 defaultEdgeOptions：后者只影响首次挂载后的新边，
 * 已经渲染出来的边不会跟着变，所以这里显式写进每条边。
 */
export const useFlowStore = create<FlowState>((set) => ({
  nodes: [],
  edges: [],
  edgeType: 'smoothstep',
  clipboard: null,

  onNodesChange: (changes) => set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) => set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

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

  updateNodeLabel: (id, label) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, label } } : node,
      ),
    })),

  deleteSelection: () =>
    set((state) => {
      const nodeIds = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id));
      const edgeIds = new Set(state.edges.filter((edge) => edge.selected).map((edge) => edge.id));
      if (nodeIds.size === 0 && edgeIds.size === 0) return state;

      return {
        nodes: state.nodes.filter((node) => !nodeIds.has(node.id)),
        // 选中连线直接删除；端点被删掉的连线一并清理
        edges: state.edges.filter(
          (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
        ),
      };
    }),

  copySelection: () =>
    set((state) => {
      const nodes = state.nodes.filter((node) => node.selected);
      if (nodes.length === 0) return state;
      const ids = new Set(nodes.map((node) => node.id));
      return {
        clipboard: {
          nodes,
          // 只带走两端都在选区内的连线
          edges: state.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
        },
      };
    }),

  pasteClipboard: () =>
    set((state) => {
      const clipboard = state.clipboard;
      if (!clipboard || clipboard.nodes.length === 0) return state;

      const idMap = new Map<string, string>();
      for (const node of clipboard.nodes) idMap.set(node.id, nanoid(8));
      const remap = (id: string, kind: string): string => {
        const next = idMap.get(id);
        if (!next) throw new Error(`剪贴板中的${kind} ${id} 缺少新 id 映射`);
        return next;
      };

      const pastedNodes = clipboard.nodes.map((node) => ({
        ...node,
        id: remap(node.id, '节点'),
        position: { x: node.position.x + PASTE_OFFSET, y: node.position.y + PASTE_OFFSET },
        selected: true,
      }));

      const pastedEdges = clipboard.edges.map((edge) => ({
        ...edge,
        id: nanoid(8),
        source: remap(edge.source, '连线端点'),
        target: remap(edge.target, '连线端点'),
        selected: false,
      }));

      return {
        nodes: [...deselectAll(state.nodes), ...pastedNodes],
        edges: [...deselectAll(state.edges), ...pastedEdges],
        // 快照前移，连续按 Ctrl+V 会逐次错开而不是完全重叠
        clipboard: {
          nodes: clipboard.nodes.map((node) => ({
            ...node,
            position: { x: node.position.x + PASTE_OFFSET, y: node.position.y + PASTE_OFFSET },
          })),
          edges: clipboard.edges,
        },
      };
    }),

  selectAll: () =>
    set((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: true })),
      edges: state.edges.map((edge) => ({ ...edge, selected: true })),
    })),

  clearSelection: () =>
    set((state) => ({
      nodes: deselectAll(state.nodes),
      edges: deselectAll(state.edges),
    })),
}));
