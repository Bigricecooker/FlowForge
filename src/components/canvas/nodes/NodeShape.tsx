import type { JSX } from 'react';

import { getShapeDef } from '../../palette/shapeDefs';
import type { ShapeKind } from '../../palette/shapeDefs';
import styles from './FlowNode.module.css';

const STROKE_INSET = 0.75;

/** 所有轮廓共用的样式类（fill / stroke 定义在 CSS 里，便于选中态覆盖）。 */
const PRIMITIVE = { className: styles.primitive };

/**
 * 节点轮廓。几何按 shapeDefs 里的固定尺寸精确计算，viewBox 与节点盒子 1:1，
 * 因此不存在缩放拉伸。样式类与 FlowNode 共用同一个 CSS Module，选中态可直接命中。
 */
export default function NodeShape({ kind }: { kind: ShapeKind }) {
  const { width: w, height: h } = getShapeDef(kind);
  const s = STROKE_INSET;

  let geometry: JSX.Element;
  switch (kind) {
    case 'process':
      geometry = <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} {...PRIMITIVE} />;
      break;
    case 'rounded':
      geometry = <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={8} {...PRIMITIVE} />;
      break;
    case 'decision':
      geometry = (
        <polygon
          points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`}
          {...PRIMITIVE}
        />
      );
      break;
    case 'io': {
      const skew = 14;
      geometry = (
        <polygon
          points={`${skew},${s} ${w - s},${s} ${w - skew},${h - s} ${s},${h - s}`}
          {...PRIMITIVE}
        />
      );
      break;
    }
    case 'terminator':
      geometry = <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={h / 2} {...PRIMITIVE} />;
      break;
  }

  return (
    <svg
      className={styles.shape}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
      data-shape={kind}
    >
      {geometry}
    </svg>
  );
}
