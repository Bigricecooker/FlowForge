import { useDragStore } from '../../store/dragStore';
import ShapePreview from './ShapePreview';
import { SHAPE_DEFS } from './shapeDefs';
import styles from './ShapeLibrary.module.css';

/** 左侧图形库：按下即开始拖拽，落到画布由 FlowCanvas 完成。 */
export default function ShapeLibrary() {
  const startDrag = useDragStore((state) => state.start);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>图形库</h2>
        <p className={styles.hint}>将图形拖拽到画布</p>
      </header>

      <ul className={styles.list}>
        {SHAPE_DEFS.map((def) => (
          <li
            key={def.kind}
            className={styles.item}
            title={`拖拽「${def.label}」到画布`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              startDrag(def.kind, { x: event.clientX, y: event.clientY });
            }}
          >
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
