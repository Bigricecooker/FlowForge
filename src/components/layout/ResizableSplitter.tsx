import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import styles from './ResizableSplitter.module.css';

interface ResizableSplitterProps {
  /** 分隔条位于面板的哪一侧，决定拖拽方向。 */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (width: number) => void;
}

/** 拖拽调整面板宽度，双击复位到默认值。 */
export default function ResizableSplitter({
  side,
  width,
  min,
  max,
  defaultValue,
  onChange,
}: ResizableSplitterProps) {
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const delta = event.clientX - start.x;
    const next = side === 'left' ? start.width + delta : start.width - delta;
    onChange(Math.min(Math.max(next, min), max));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  return (
    <div
      className={styles.splitter}
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板宽度"
      title="拖拽调整宽度，双击复位"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(defaultValue)}
    />
  );
}
