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

/** 撤销栈上限。快照保存的是数组引用（状态更新始终不可变），因此成本很低。 */
const HISTORY_LIMIT = 100;

/** 一次撤销覆盖的文档内容。视口与光标不在其中——它们属于 viewStore。 */
interface FlowDoc {
  nodes: FlowNode[];
  edges: FlowEdge[];
  edgeType: EdgeType;
}

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

  past: FlowDoc[];
  future: FlowDoc[];
  /** 连续手势（拖拽）开始时的快照；手势结束时才决定是否入栈。 */
  pending: FlowDoc | null;

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

  /** 开始一次连续手势：记录手势前的文档。 */
  beginTransaction: () => void;
  /** 结束连续手势：确有变化才入栈。 */
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;
}

const deselectAll = <T extends { selected?: boolean }>(items: T[]): T[] =>
  items.map((item) => (item.selected ? { ...item, selected: false } : item));

const takeSnapshot = (doc: FlowDoc): FlowDoc => ({
  nodes: doc.nodes,
  edges: doc.edges,
  edgeType: doc.edgeType,
});

/**
 * 文档变更的统一出口：先把变更前的文档压入历史，再应用变更。
 * 所有会改文档的动作都经它，撤销粒度才等于"一次用户操作"。
 * `changes` 允许带上剪贴板这类非文档字段（它们不进历史）。
 */
const withHistory = (state: FlowState, changes: Partial<FlowState>): Partial<FlowState> => ({
  ...changes,
  past: [...state.past, takeSnapshot(state)].slice(-HISTORY_LIMIT),
  future: [],
});

/**
 * 还原快照。选中态不进历史，而是沿用"当前"的选中：
 * 撤销一次删除后节点会回来，但不会把当时的选中状态一起带回来。
 */
const applyDoc = (
  state: FlowState,
  doc: FlowDoc,
): Pick<FlowState, 'nodes' | 'edges' | 'edgeType'> => {
  const selectedNodes = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id));
  const selectedEdges = new Set(state.edges.filter((edge) => edge.selected).map((edge) => edge.id));
  return {
    nodes: doc.nodes.map((node) => ({ ...node, selected: selectedNodes.has(node.id) })),
    edges: doc.edges.map((edge) => ({ ...edge, selected: selectedEdges.has(edge.id) })),
    edgeType: doc.edgeType,
  };
};

/**
 * 手势是否真的改了文档。只比较会被手势改动的部分（节点位置），
 * 这样"点一下没拖动"不会留下一步空撤销，选中变化也不会被误判成编辑。
 */
const sameDoc = (a: FlowDoc, b: FlowDoc): boolean => {
  if (a.edgeType !== b.edgeType) return false;
  if (a.nodes === b.nodes && a.edges === b.edges) return true;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  for (let index = 0; index < a.nodes.length; index += 1) {
    const before = a.nodes[index];
    const after = b.nodes[index];
    if (
      before.id !== after.id ||
      before.position.x !== after.position.x ||
      before.position.y !== after.position.y
    ) {
      return false;
    }
  }
  return true;
};

/**
 * 文档状态：节点、连线、连线样式、剪贴板与撤销栈。
 * 连线样式不依赖 React Flow 的 defaultEdgeOptions：后者只影响首次挂载后的新边，
 * 已经渲染出来的边不会跟着变，所以这里显式写进每条边。
 */
export const useFlowStore = create<FlowState>((set) => ({
  nodes: [],
  edges: [],
  edgeType: 'smoothstep',
  clipboard: null,
  past: [],
  future: [],
  pending: null,

  // 拖动过程中的每帧位置变更不入栈；由 begin/endTransaction 在手势两端处理
  onNodesChange: (changes) => set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) => set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) =>
      withHistory(state, {
        edges: addEdge(
          { ...connection, id: nanoid(8), type: toFlowEdgeType(state.edgeType) },
          state.edges,
        ),
      }),
    ),

  setEdgeType: (edgeType) =>
    set((state) =>
      withHistory(state, {
        edgeType,
        edges: state.edges.map((edge) => ({ ...edge, type: toFlowEdgeType(edgeType) })),
      }),
    ),

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
      return withHistory(state, { nodes: [...state.nodes, node] });
    }),

  updateNodeLabel: (id, label) =>
    set((state) =>
      withHistory(state, {
        nodes: state.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label } } : node,
        ),
      }),
    ),

  deleteSelection: () =>
    set((state) => {
      const nodeIds = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id));
      const edgeIds = new Set(state.edges.filter((edge) => edge.selected).map((edge) => edge.id));
      if (nodeIds.size === 0 && edgeIds.size === 0) return state;

      return withHistory(state, {
        nodes: state.nodes.filter((node) => !nodeIds.has(node.id)),
        // 选中连线直接删除；端点被删掉的连线一并清理
        edges: state.edges.filter(
          (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
        ),
      });
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

      return withHistory(state, {
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
      });
    }),

  // 选中态不是文档内容，不进撤销栈
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

  beginTransaction: () =>
    set((state) => (state.pending ? state : { pending: takeSnapshot(state) })),

  endTransaction: () =>
    set((state) => {
      const pending = state.pending;
      if (!pending) return state;
      if (sameDoc(pending, state)) return { pending: null };
      return {
        pending: null,
        past: [...state.past, pending].slice(-HISTORY_LIMIT),
        future: [],
      };
    }),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...applyDoc(state, previous),
        past: state.past.slice(0, -1),
        future: [...state.future, takeSnapshot(state)].slice(-HISTORY_LIMIT),
        pending: null,
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future.at(-1);
      if (!next) return state;
      return {
        ...applyDoc(state, next),
        past: [...state.past, takeSnapshot(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(0, -1),
        pending: null,
      };
    }),
}));
