import type { XYPosition } from '@xyflow/react';
import dagre from 'dagre';

import { getShapeDef } from '../components/palette/shapeDefs';
import type { FlowEdge, FlowNode } from '../store/types';

/** 竖向分层；行距列距按节点尺寸留出呼吸空间，四周留边距。 */
const LAYOUT = { rankdir: 'TB', nodesep: 60, ranksep: 80, marginx: 32, marginy: 32 } as const;

/** 判定"同层"的中心 y 容差（dagre 对同层节点按中心对齐，实测偏差为 0）。 */
const BAND_TOLERANCE = 2;

export type HandleSide = 'top' | 'right' | 'bottom' | 'left';

export interface AutoLayoutResult {
  /** 每个节点新的左上角坐标（未参与布局的节点不出现在结果里）。 */
  positions: Map<string, XYPosition>;
  /** 每条连线按新方位应改用的锚点。 */
  handles: Map<string, { sourceHandle: HandleSide; targetHandle: HandleSide }>;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所在层序号；同层为同一序号。由布局结果的中心 y 反推，不依赖 dagre 的内部字段。 */
  band: number;
}

/**
 * 按两节点的相对方位挑一对锚点，让连线从朝向对方的那一侧出入。
 *
 * 为什么布局必须重挑锚点：锚点是画线时手选的，布局把节点搬到别处之后，原来的锚点可能
 * 落在背向对方的一侧——例如"底 → 底"而目标正好被排到正下方时，线要够到目标的底边，
 * 就只能从源节点下来直接穿过目标节点（实测该场景下 120 个采样点里有 34 个落在节点内部）。
 *
 * 判据用"层"而不是中心距离：竖向分层里"偏左下方的节点"按距离判会被误判成侧向连接，
 * 于是连线绕到右侧再折回左侧；按层判则永远得到上下连接，与分层方向一致。
 */
export function pickHandles(
  source: Box,
  target: Box,
): { sourceHandle: HandleSide; targetHandle: HandleSide } {
  if (source.band !== target.band) {
    return target.band > source.band
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' };
  }

  // 同层：左右相连
  const dx = target.x + target.w / 2 - (source.x + source.w / 2);
  return dx >= 0
    ? { sourceHandle: 'right', targetHandle: 'left' }
    : { sourceHandle: 'left', targetHandle: 'right' };
}

/** 把节点按中心 y 归层：同一层返回同一序号，序号自上而下递增。 */
function assignBands(entries: { id: string; centerY: number }[]): Map<string, number> {
  const levels: number[] = [];
  for (const entry of entries) {
    const hit = levels.find((level) => Math.abs(level - entry.centerY) <= BAND_TOLERANCE);
    if (hit === undefined) levels.push(entry.centerY);
  }
  levels.sort((a, b) => a - b);

  const bands = new Map<string, number>();
  for (const entry of entries) {
    let nearest = 0;
    for (let index = 1; index < levels.length; index += 1) {
      if (Math.abs(levels[index] - entry.centerY) < Math.abs(levels[nearest] - entry.centerY)) {
        nearest = index;
      }
    }
    bands.set(entry.id, nearest);
  }
  return bands;
}

/**
 * 用 dagre 计算分层布局：节点新坐标 + 每条连线应改用的锚点。
 * 尺寸直接取 shapeDefs 的固定值——这正是当初把节点尺寸写死、不依赖首帧测量的收益之一。
 */
export function computeAutoLayout(nodes: FlowNode[], edges: FlowEdge[]): AutoLayoutResult {
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
  const boxes = new Map<string, Omit<Box, 'band'>>();
  const centers: { id: string; centerY: number }[] = [];

  for (const node of nodes) {
    const laid = graph.node(node.id) as { x: number; y: number } | undefined;
    if (!laid) continue;
    const def = getShapeDef(node.data.kind);
    // dagre 给的是中心点，节点坐标存的是左上角
    const position = { x: laid.x - def.width / 2, y: laid.y - def.height / 2 };
    positions.set(node.id, position);
    boxes.set(node.id, { ...position, w: def.width, h: def.height });
    centers.push({ id: node.id, centerY: position.y + def.height / 2 });
  }

  const bands = assignBands(centers);

  const handles = new Map<string, { sourceHandle: HandleSide; targetHandle: HandleSide }>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) continue;
    handles.set(
      edge.id,
      pickHandles(
        { ...source, band: bands.get(edge.source) ?? 0 },
        { ...target, band: bands.get(edge.target) ?? 0 },
      ),
    );
  }

  return { positions, handles };
}
