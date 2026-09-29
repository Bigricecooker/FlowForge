import { useFlowStore } from '../../store/flowStore';
import { SHAPE_DEFS } from '../palette/shapeDefs';
import styles from './NodePropertiesPanel.module.css';

/**
 * 节点属性面板（首批唯一面板）。
 * 当前所有图形的属性集合相同，所以只读展示；按图形类型区分属性的能力待后续接入。
 */
export default function NodePropertiesPanel() {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdgeCount = edges.filter((edge) => edge.selected).length;

  if (selectedNodes.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          {selectedEdgeCount > 0
            ? `已选中 ${selectedEdgeCount} 条连线（连线属性待补充）`
            : '未选中任何节点'}
        </p>
      </div>
    );
  }

  if (selectedNodes.length > 1) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>已选中 {selectedNodes.length} 个节点（暂不支持批量查看）</p>
      </div>
    );
  }

  const node = selectedNodes[0];
  const def = SHAPE_DEFS.find((item) => item.kind === node.data.kind);
  const rows = [
    { label: '图形', value: def?.label ?? node.data.kind },
    { label: '文字', value: node.data.label },
    { label: '位置', value: `${Math.round(node.position.x)}, ${Math.round(node.position.y)}` },
    { label: '尺寸', value: `${def?.width ?? '—'} × ${def?.height ?? '—'}` },
  ];

  return (
    <div className={styles.panel}>
      <dl className={styles.list}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.label}>{row.label}</dt>
            <dd className={styles.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>位置是画布世界坐标；拖动节点时这里会实时更新</p>
    </div>
  );
}
