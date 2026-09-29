import styles from './FlowCanvas.module.css';

interface FlowCanvasProps {
  onOpenShortcuts: () => void;
}

/** 画布区域。M1 只有工具条与点阵底纹，React Flow 实例在 M3 接入。 */
export default function FlowCanvas({ onOpenShortcuts }: FlowCanvasProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>画布</span>
        <span className={styles.spacer} />
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

      <div className={styles.body}>
        <p className={styles.hint}>画布已就位 · 图形拖拽下一步接入</p>
      </div>
    </div>
  );
}
