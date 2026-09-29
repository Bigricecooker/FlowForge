import type { XYPosition } from '@xyflow/react';
import { create } from 'zustand';

import type { ShapeKind } from '../components/palette/shapeDefs';

interface DragState {
  /** 正在被拖拽的图形类型，null 表示没有拖拽。 */
  kind: ShapeKind | null;
  /** 光标屏幕坐标，用于渲染跟随指针的幽灵预览。 */
  pointer: XYPosition | null;
  start: (kind: ShapeKind, pointer: XYPosition) => void;
  move: (pointer: XYPosition) => void;
  end: () => void;
}

/** 图形库到画布的拖拽态：图形库负责 start，画布负责 move 与落图。 */
export const useDragStore = create<DragState>((set) => ({
  kind: null,
  pointer: null,
  start: (kind, pointer) => set({ kind, pointer }),
  move: (pointer) => set((state) => (state.kind === null ? state : { pointer })),
  end: () => set({ kind: null, pointer: null }),
}));
