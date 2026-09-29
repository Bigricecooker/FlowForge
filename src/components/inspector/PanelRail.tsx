import type { PanelId } from './panels';
import { PANELS } from './panels';
import styles from './PanelRail.module.css';

interface PanelRailProps {
  /** 当前激活的面板；暂留区收起时为 null。 */
  activeId: PanelId | null;
  /** 已经打开（有分页）的面板，用于给出"已打开但未激活"的细微提示。 */
  openIds: readonly PanelId[];
  onSelect: (id: PanelId) => void;
}

/** 最右侧的控件栏：一列图标，点谁就在暂留区显示谁。固定宽度，不可折叠。 */
export default function PanelRail({ activeId, openIds, onSelect }: PanelRailProps) {
  return (
    <nav className={styles.rail} aria-label="暂留区面板">
      {PANELS.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className={styles.button}
          data-active={panel.id === activeId ? '' : undefined}
          data-open={openIds.includes(panel.id) ? '' : undefined}
          aria-pressed={panel.id === activeId}
          title={panel.title}
          onClick={() => onSelect(panel.id)}
        >
          {panel.icon}
        </button>
      ))}
    </nav>
  );
}
