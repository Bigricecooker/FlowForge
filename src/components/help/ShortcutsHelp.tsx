import { useEffect, useRef } from 'react';

import { KEYBOARD_SHORTCUTS, MOUSE_ACTIONS } from '../../lib/shortcuts';
import type { ShortcutRow } from '../../lib/shortcuts';
import styles from './ShortcutsHelp.module.css';

interface ShortcutsHelpProps {
  onClose: () => void;
}

function ShortcutSection({ title, rows }: { title: string; rows: readonly ShortcutRow[] }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <table className={styles.table}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.keys}>
              <th scope="row" className={styles.keyCell}>
                <kbd className={styles.kbd}>{row.keys}</kbd>
              </th>
              <td className={styles.actionCell}>{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 快捷键说明浮层：由 ? 按钮、? 键打开，Esc / 点击遮罩 / 关闭按钮关闭。 */
export default function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <div className={styles.overlay} onPointerDown={onClose} role="presentation">
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="shortcuts-title" className={styles.title}>
            快捷键与鼠标操作
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <ShortcutSection title="键盘" rows={KEYBOARD_SHORTCUTS} />
        <ShortcutSection title="鼠标" rows={MOUSE_ACTIONS} />

        <p className={styles.footnote}>按 Esc 或点击浮层外任意位置关闭</p>
      </div>
    </div>
  );
}
