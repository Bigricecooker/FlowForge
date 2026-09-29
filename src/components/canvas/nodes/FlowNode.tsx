import type { NodeProps } from '@xyflow/react';

import type { FlowNode as FlowNodeType } from '../../../store/types';
import styles from './FlowNode.module.css';
import NodeShape from './NodeShape';

/** 画布上的通用节点：SVG 轮廓 + 居中标签。双击改名在 M4 接入。 */
export default function FlowNode({ data, selected }: NodeProps<FlowNodeType>) {
  return (
    <div className={styles.node} data-selected={selected ? '' : undefined}>
      <NodeShape kind={data.kind} />
      <span className={styles.label}>{data.label}</span>
    </div>
  );
}
