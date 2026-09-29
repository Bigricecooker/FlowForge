import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import type { FlowNode as FlowNodeType } from '../../../store/types';
import type { ShapeKind } from '../../palette/shapeDefs';
import styles from './FlowNode.module.css';
import NodeShape from './NodeShape';

/**
 * 左右锚点的内缩量。平行四边形（io）的左右边是斜的，锚点要退到斜边中点才贴合轮廓；
 * 其余图形取包围盒中点即为轮廓顶点或边中点，无需内缩。
 */
const SIDE_INSET: Partial<Record<ShapeKind, number>> = { io: 7 };

/** 画布上的通用节点：SVG 轮廓 + 居中标签 + 四向锚点。双击改名在 M4 接入。 */
export default function FlowNode({ data, selected }: NodeProps<FlowNodeType>) {
  const inset = SIDE_INSET[data.kind] ?? 0;

  return (
    <div className={styles.node} data-selected={selected ? '' : undefined}>
      <NodeShape kind={data.kind} />

      <Handle id="top" type="source" position={Position.Top} className={styles.handle} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={styles.handle} />
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        className={styles.handle}
        style={inset ? { left: inset } : undefined}
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className={styles.handle}
        style={inset ? { right: inset } : undefined}
      />

      <span className={styles.label}>{data.label}</span>
    </div>
  );
}
