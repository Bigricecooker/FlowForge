import styles from './RightPanel.module.css';

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * 右侧暂留区。本阶段只有一个空面板占位，
 * 后续接 AI / 属性面板时再从状态层读取 selection。
 */
export default function RightPanel({ collapsed, onToggle }: RightPanelProps) {
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
          <dd>无</dd>
        </dl>
      </div>
    </div>
  );
}
