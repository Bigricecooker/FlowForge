import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import { useFlowStore } from '../../../store/flowStore';
import type { FlowNode as FlowNodeType } from '../../../store/types';
import type { ShapeKind } from '../../palette/shapeDefs';
import styles from './FlowNode.module.css';
import NodeShape from './NodeShape';

/**
 * 左右锚点的内缩量。平行四边形（io）的左右边是斜的，锚点要退到斜边中点才贴合轮廓；
 * 其余图形取包围盒中点即为轮廓顶点或边中点，无需内缩。
 */
const SIDE_INSET: Partial<Record<ShapeKind, number>> = { io: 7 };

/** 画布上的通用节点：SVG 轮廓 + 居中标签 + 四向锚点，双击进入内联改名。 */
export default function FlowNode({ id, data, selected }: NodeProps<FlowNodeType>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const updateNodeLabel = useFlowStore((state) => state.updateNodeLabel);

  const inset = SIDE_INSET[data.kind] ?? 0;

  const startEditing = () => {
    setDraft(data.label);
    setEditing(true);
  };

  /** 提交：空文本视为放弃修改，保持原标签。 */
  const commit = () => {
    const next = draft.trim();
    if (next.length > 0 && next !== data.label) updateNodeLabel(id, next);
    setEditing(false);
  };

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

      {editing ? (
        <textarea
          className={`${styles.label} ${styles.editor} nodrag`}
          value={draft}
          rows={1}
          autoFocus
          aria-label="节点文字"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // 拦住冒泡：否则 Enter / Esc 会同时触发画布级快捷键
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className={styles.label}
          onDoubleClick={(event) => {
            event.stopPropagation();
            startEditing();
          }}
        >
          {data.label}
        </span>
      )}
    </div>
  );
}
