import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import FlowCanvas from '../canvas/FlowCanvas';
import ShortcutsHelp from '../help/ShortcutsHelp';
import ReservedArea from '../inspector/ReservedArea';
import ShapeLibrary from '../palette/ShapeLibrary';
import { useFlowStore } from '../../store/flowStore';
import { useViewStore } from '../../store/viewStore';
import styles from './AppShell.module.css';
import ResizableSplitter from './ResizableSplitter';
import StatusBar from './StatusBar';

const LEFT = { default: 260, min: 200, max: 400 };
const RIGHT = { default: 320, min: 260, max: 520 };

type ShellVars = CSSProperties & { '--left-w': string; '--right-w': string };

/** 三栏骨架：左图形库 / 中画布 / 右暂留区 + 底部状态栏。 */
export default function AppShell() {
  const [leftWidth, setLeftWidth] = useState(LEFT.default);
  const [rightWidth, setRightWidth] = useState(RIGHT.default);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const zoom = useViewStore((state) => state.zoom);
  const cursor = useViewStore((state) => state.cursor);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const edgeCount = useFlowStore((state) => state.edges.length);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (event.key === '?' && !typing) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') setHelpOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 收起时面板区宽度归零，右侧控件栏固定保留（--rail-w 在 tokens.css）
  const shellStyle: ShellVars = {
    '--left-w': `${leftWidth}px`,
    '--right-w': `${rightCollapsed ? 0 : rightWidth}px`,
  };

  return (
    <>
      <div className={styles.shell} style={shellStyle}>
        <div className={styles.main}>
          <aside className={styles.left}>
            <ShapeLibrary />
          </aside>

          <ResizableSplitter
            side="left"
            width={leftWidth}
            defaultValue={LEFT.default}
            min={LEFT.min}
            max={LEFT.max}
            onChange={setLeftWidth}
          />

          <main className={styles.canvas}>
            <FlowCanvas onOpenShortcuts={() => setHelpOpen(true)} />
          </main>

          {!rightCollapsed && (
            <ResizableSplitter
              side="right"
              width={rightWidth}
              defaultValue={RIGHT.default}
              min={RIGHT.min}
              max={RIGHT.max}
              onChange={setRightWidth}
            />
          )}

          <aside className={styles.right}>
            <ReservedArea
              collapsed={rightCollapsed}
              onToggle={() => setRightCollapsed((value) => !value)}
            />
          </aside>
        </div>

        <StatusBar zoom={zoom} cursor={cursor} nodeCount={nodeCount} edgeCount={edgeCount} />
      </div>

      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}
