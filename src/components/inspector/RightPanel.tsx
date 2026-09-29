import { useMemo } from 'react';

import { useFlowStore } from '../../store/flowStore';
import styles from './RightPanel.module.css';

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** 把选中状态说成一句话。只有一个节点时直接给出它的文字，便于将来做上下文。 */
function describeSelection(nodeCount: number, edgeCount: number, singleLabel: string | null) {
  if (nodeCount === 0 && edgeCount === 0) return '无';
  if (nodeCount === 1 && edgeCount === 0 && singleLabel) return `节点「${singleLabel}」`;
  const parts: string[] = [];
  if (nodeCount > 0) parts.push(`${nodeCount} 个节点`);
  if (edgeCount > 0) parts.push(`${edgeCount} 条连线`);
  return `已选 ${parts.join('、')}`;
}

/**
 * 右侧暂留区。本阶段回显选中上下文（将来接 AI / 属性面板时直接读同一份状态），
 * 面板本身仍是空壳。
 */
export default function RightPanel({ collapsed, onToggle }: RightPanelProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);

  const selected = useMemo(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    return {
      nodeCount: selectedNodes.length,
      edgeCount: edges.filter((edge) => edge.selected).length,
      singleLabel: selectedNodes.length === 1 ? selectedNodes[0].data.label : null,
    };
  }, [nodes, edges]);

  if (collapsed) {
    return (
      <div className={styles.collapsed}>
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          title="展开暂留区"
          aria-label="展开暂留区"
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>暂留区</h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          title="收起暂留区"
          aria-label="收起暂留区"
        >
          ›
        </button>
      </header>

      <div className={styles.body}>
        <p className={styles.placeholder}>预留区域，后续接入</p>
        <dl className={styles.meta}>
          <dt>当前选中</dt>
          <dd data-testid="selection-summary">
            {describeSelection(selected.nodeCount, selected.edgeCount, selected.singleLabel)}
          </dd>
        </dl>
      </div>
    </div>
  );
}
