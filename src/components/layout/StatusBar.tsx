import styles from './StatusBar.module.css';

export interface CursorPosition {
  x: number;
  y: number;
}

interface StatusBarProps {
  /** 当前缩放倍数，1 表示 100%。 */
  zoom: number;
  /** 光标在世界坐标下的位置，未进入画布时为 null。 */
  cursor: CursorPosition | null;
  nodeCount: number;
  edgeCount: number;
}

export default function StatusBar({ zoom, cursor, nodeCount, edgeCount }: StatusBarProps) {
  return (
    <footer className={styles.bar}>
      <span className={styles.item}>缩放 {Math.round(zoom * 100)}%</span>
      <span className={styles.item}>
        {cursor ? `x ${Math.round(cursor.x)}, y ${Math.round(cursor.y)}` : '坐标 —'}
      </span>
      <span className={styles.item}>节点 {nodeCount}</span>
      <span className={styles.item}>连线 {edgeCount}</span>
      <span className={styles.spacer} />
      <span className={styles.brand}>FlowForge</span>
    </footer>
  );
}
