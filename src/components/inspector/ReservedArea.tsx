import { useState } from 'react';

import PanelRail from './PanelRail';
import type { PanelId } from './panels';
import { PANELS } from './panels';
import styles from './ReservedArea.module.css';

interface ReservedAreaProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * 暂留区：面板容器。由「顶栏分页 + 面板主体 + 右侧控件栏」三部分组成，
 * 谁能出现在这里完全由 panels.tsx 的注册表决定。
 *
 * 面板开关是纯界面状态，且只被这一个子树使用，因此留在组件本地 state：
 * 不进 store（没有跨子树读者），也不进撤销栈（不是文档内容）。
 */
export default function ReservedArea({ collapsed, onToggle }: ReservedAreaProps) {
  const [openIds, setOpenIds] = useState<PanelId[]>([]);
  const [activeId, setActiveId] = useState<PanelId | null>(null);

  /** 点控件栏：没打开就开一个分页，已打开就激活；暂留区收起时顺带展开。 */
  const handleSelect = (id: PanelId) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveId(id);
    if (collapsed) onToggle();
  };

  const closePanel = (id: PanelId) => {
    const next = openIds.filter((item) => item !== id);
    setOpenIds(next);
    // 关掉当前分页后落到相邻分页，全关则回到空状态
    if (activeId === id) setActiveId(next.at(-1) ?? null);
  };

  const activePanel = PANELS.find((panel) => panel.id === activeId) ?? null;
  const ActiveComponent = activePanel?.component;

  return (
    <div className={styles.area}>
      <div className={styles.panes} data-collapsed={collapsed ? '' : undefined}>
        {!collapsed && (
          <>
            <header className={styles.tabs}>
              <ul className={styles.tabList} role="tablist" aria-label="已打开的面板">
                {openIds.map((id) => {
                  const panel = PANELS.find((item) => item.id === id);
                  if (!panel) return null;
                  return (
                    <li
                      key={id}
                      className={styles.tab}
                      data-active={id === activeId ? '' : undefined}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={id === activeId}
                        className={styles.tabButton}
                        onClick={() => setActiveId(id)}
                      >
                        {panel.title}
                      </button>
                      <button
                        type="button"
                        className={styles.tabClose}
                        aria-label={`关闭${panel.title}`}
                        title={`关闭${panel.title}`}
                        onClick={() => closePanel(id)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
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

            <div className={styles.body} role="tabpanel">
              {ActiveComponent ? (
                <ActiveComponent />
              ) : (
                <p className={styles.empty}>从右侧控件栏选择一个面板</p>
              )}
            </div>
          </>
        )}
      </div>

      <PanelRail activeId={collapsed ? null : activeId} openIds={openIds} onSelect={handleSelect} />
    </div>
  );
}
