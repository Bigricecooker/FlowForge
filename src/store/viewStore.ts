import type { XYPosition } from '@xyflow/react';
import { create } from 'zustand';

interface ViewState {
  /** 画布缩放倍数，1 为 100%。 */
  zoom: number;
  /** 光标在世界坐标下的位置。 */
  cursor: XYPosition | null;
  setZoom: (zoom: number) => void;
  setCursor: (cursor: XYPosition | null) => void;
}

/** 视口与光标等瞬时状态，刻意独立于文档状态，不进撤销栈。 */
export const useViewStore = create<ViewState>((set) => ({
  zoom: 1,
  cursor: null,
  setZoom: (zoom) => set({ zoom }),
  setCursor: (cursor) => set({ cursor }),
}));
