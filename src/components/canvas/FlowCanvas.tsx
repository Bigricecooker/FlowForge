import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, DefaultEdgeOptions, Edge } from '@xyflow/react';

import { EDGE_MARKER_COLOR } from '../../lib/edgeTypes';
import type { EdgeType } from '../../lib/edgeTypes';
import { useDragStore } from '../../store/dragStore';
import { useFlowStore } from '../../store/flowStore';
import { useViewStore } from '../../store/viewStore';
import ShapePreview from '../palette/ShapePreview';
import EdgeTypeSwitch from './EdgeTypeSwitch';
import styles from './FlowCanvas.module.css';
import FlowNodeView from './nodes/FlowNode';

/** 定义在模块作用域，避免每次渲染重建导致 React Flow 整树重挂。 */
const nodeTypes = { flow: FlowNodeView };

/** 与 tokens.css 的 --grid-dot 保持一致（SVG 属性不解析 CSS 变量）。 */
const GRID_COLOR = '#d9dde3';

/** 拖拽中的连线走与落成后一致的形态。 */
const CONNECTION_LINE_TYPE: Record<EdgeType, ConnectionLineType> = {
  smoothstep: ConnectionLineType.SmoothStep,
  bezier: ConnectionLineType.Bezier,
  straight: ConnectionLineType.Straight,
};

interface FlowCanvasProps {
  onOpenShortcuts: () => void;
}

/** 画布区域：React Flow 实例 + 图形库落图 + 连线。 */
export default function FlowCanvas({ onOpenShortcuts }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas onOpenShortcuts={onOpenShortcuts} />
    </ReactFlowProvider>
  );
}

function Canvas({ onOpenShortcuts }: FlowCanvasProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const onNodesChange = useFlowStore((state) => state.onNodesChange);
  const onEdgesChange = useFlowStore((state) => state.onEdgesChange);
  const onConnect = useFlowStore((state) => state.onConnect);
  const addNode = useFlowStore((state) => state.addNode);
  const edgeType = useFlowStore((state) => state.edgeType);
  const setEdgeType = useFlowStore((state) => state.setEdgeType);

  const draggingKind = useDragStore((state) => state.kind);
  const dragPointer = useDragStore((state) => state.pointer);

  const setZoom = useViewStore((state) => state.setZoom);
  const setCursor = useViewStore((state) => state.setCursor);

  // 线条颜色交给 CSS 变量，选中态才能由样式表覆盖；边型写在每条边上（见 flowStore）。
  const defaultEdgeOptions = useMemo<DefaultEdgeOptions>(
    () => ({
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_MARKER_COLOR },
    }),
    [],
  );

  // 松手模式（Loose）下任意锚点都能互连，唯独禁止同一个锚点连自己。
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      !(
        connection.source === connection.target &&
        connection.sourceHandle === connection.targetHandle
      ),
    [],
  );

  // 拖拽期间在 window 上跟踪指针：指针移出画布时幽灵预览仍然跟随，
  // 松手时再判断落点是否在画布内。屏幕坐标经 screenToFlowPosition 换算成世界坐标，
  // 因此缩放与平移后落点依然精确。
  useEffect(() => {
    if (!draggingKind) return;

    const handleMove = (event: PointerEvent) => {
      useDragStore.getState().move({ x: event.clientX, y: event.clientY });
    };

    const finish = (event: PointerEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      const inside =
        rect !== undefined &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (inside) {
        addNode(draggingKind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }
      useDragStore.getState().end();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [draggingKind, addNode, screenToFlowPosition]);

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    setCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>画布</span>
        <span className={styles.spacer} />
        <EdgeTypeSwitch value={edgeType} onChange={setEdgeType} />
        <button
          type="button"
          className={styles.iconButton}
          onClick={onOpenShortcuts}
          title="快捷键（?）"
          aria-label="查看快捷键"
        >
          ?
        </button>
      </div>

      <div
        ref={bodyRef}
        className={styles.body}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setCursor(null)}
      >
        <ReactFlow
          className={styles.flow}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={CONNECTION_LINE_TYPE[edgeType]}
          isValidConnection={isValidConnection}
          defaultEdgeOptions={defaultEdgeOptions}
          onMove={(_, viewport) => setZoom(viewport.zoom)}
          minZoom={0.25}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color={GRID_COLOR} />
        </ReactFlow>

        {nodes.length === 0 && <p className={styles.hint}>从左侧图形库拖拽图形到画布</p>}

        {draggingKind && dragPointer && (
          <div className={styles.ghost} style={{ left: dragPointer.x, top: dragPointer.y }}>
            <ShapePreview kind={draggingKind} />
          </div>
        )}
      </div>
    </div>
  );
}
