import ShapePreview from './ShapePreview';
import { SHAPE_DEFS } from './shapeDefs';
import styles from './ShapeLibrary.module.css';

/** 左侧图形库。M1 仅静态展示，拖拽落图在 M2 接入。 */
export default function ShapeLibrary() {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>图形库</h2>
        <p className={styles.hint}>将图形拖拽到画布</p>
      </header>

      <ul className={styles.list}>
        {SHAPE_DEFS.map((def) => (
          <li key={def.kind} className={styles.item}>
            <span className={styles.preview}>
              <ShapePreview kind={def.kind} />
            </span>
            <span className={styles.label}>{def.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
