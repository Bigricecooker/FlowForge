import type { JSX } from 'react';

import type { ShapeKind } from './shapeDefs';

const STROKE = {
  fill: 'var(--node-fill)',
  stroke: 'var(--node-stroke)',
  strokeWidth: 1.5,
  strokeLinejoin: 'round' as const,
};

function renderShape(kind: ShapeKind): JSX.Element {
  switch (kind) {
    case 'process':
      return <rect x={4} y={10} width={56} height={20} {...STROKE} />;
    case 'rounded':
      return <rect x={4} y={10} width={56} height={20} rx={6} {...STROKE} />;
    case 'decision':
      return <polygon points="32,6 60,20 32,34 4,20" {...STROKE} />;
    case 'io':
      return <polygon points="14,10 60,10 50,30 4,30" {...STROKE} />;
    case 'terminator':
      return <rect x={4} y={10} width={56} height={20} rx={10} {...STROKE} />;
  }
}

/** 图形库中的小预览图，与画布上的节点轮廓保持同一形状语义。 */
export default function ShapePreview({ kind }: { kind: ShapeKind }) {
  return (
    <svg viewBox="0 0 64 40" width={64} height={40} aria-hidden="true" focusable="false">
      {renderShape(kind)}
    </svg>
  );
}
