import type { JSX } from 'react';
import type { ComponentType } from 'react';

import NodePropertiesPanel from './NodePropertiesPanel';

/**
 * 暂留区能承载的界面清单——这是"暂留区作为容器"的唯一扩展点：
 * 新增一个界面 = 在 PANELS 里加一条，布局代码一行都不用动。
 */
export type PanelId = 'node-properties';

export interface PanelDefinition {
  id: PanelId;
  /** 顶栏分页名，同时作为控件栏按钮的悬停提示。 */
  title: string;
  /** 控件栏图标（内联 SVG；描边与填充由 PanelRail 的样式统一给）。 */
  icon: JSX.Element;
  /** 面板主体。 */
  component: ComponentType;
}

export const PANELS: readonly PanelDefinition[] = [
  {
    id: 'node-properties',
    title: '节点属性',
    icon: (
      <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" focusable="false">
        <rect x="3" y="4.5" width="18" height="6" rx="1.5" />
        <rect x="3" y="13.5" width="18" height="6" rx="1.5" />
        <path d="M7 7.5h4M7 16.5h4" />
      </svg>
    ),
    component: NodePropertiesPanel,
  },
];
