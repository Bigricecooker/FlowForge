import type { XYPosition } from '@xyflow/react';
import dagre from 'dagre';

import { getShapeDef } from '../components/palette/shapeDefs';
import type { FlowEdge, FlowNode } from '../store/types';

/** 竖向分层；行距列距按节点尺寸留出呼吸空间，四周留边距。 */
const LAYOUT = { rankdir: 'TB', nodesep: 60, ranksep: 80, marginx: 32, marginy: 32 } as const;

/**
 * 用 dagre 计算分层布局，返回每个节点新的左上角坐标（未参与布局的节点不出现在结果里）。
 * 尺寸直接取 shapeDefs 的固定值——这正是当初把节点尺寸写死、不依赖首帧测量的收益之一。
 */
export function computeAutoLayout(nodes: FlowNode[], edges: FlowEdge[]): Map<string, XYPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ ...LAYOUT });

  for (const node of nodes) {
    const def = getShapeDef(node.data.kind);
    graph.setNode(node.id, { width: def.width, height: def.height });
  }

  const known = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    // 自环与悬空端点不参与分层：前者对 dagre 无意义，后者会让它抛错
    if (edge.source === edge.target) continue;
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, XYPosition>();
  for (const node of nodes) {
    const laid = graph.node(node.id) as { x: number; y: number } | undefined;
    if (!laid) continue;
    const def = getShapeDef(node.data.kind);
    // dagre 给的是中心点，节点坐标存的是左上角
    positions.set(node.id, { x: laid.x - def.width / 2, y: laid.y - def.height / 2 });
  }
  return positions;
}
