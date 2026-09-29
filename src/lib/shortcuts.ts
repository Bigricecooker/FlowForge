/** 快捷键浮层与后续键盘绑定共用的唯一数据源。 */
export interface ShortcutRow {
  keys: string;
  action: string;
}

export const KEYBOARD_SHORTCUTS: readonly ShortcutRow[] = [
  { keys: 'Delete / Backspace', action: '删除选中的节点或连线' },
  { keys: 'Ctrl + C', action: '复制选中节点（含其之间的连线）' },
  { keys: 'Ctrl + V', action: '粘贴，偏移 24px 并重新生成 id' },
  { keys: 'Ctrl + Z', action: '撤销上一步编辑（缩放平移不入栈）' },
  { keys: 'Ctrl + Shift + Z', action: '重做' },
  { keys: 'Ctrl + Y', action: '重做（同上，Windows 习惯键）' },
  { keys: 'Ctrl + A', action: '全选节点与连线' },
  { keys: '双击节点', action: '修改节点文字（Enter 提交，Esc 取消）' },
  { keys: 'Esc', action: '取消选中 / 关闭本浮层' },
  { keys: '?', action: '打开或关闭本浮层' },
];

export const MOUSE_ACTIONS: readonly ShortcutRow[] = [
  { keys: '滚轮', action: '以光标为中心缩放画布' },
  { keys: '拖拽空白处', action: '平移画布' },
  { keys: 'Shift + 拖拽空白处', action: '框选多个节点' },
  { keys: '拖拽节点', action: '移动节点（可多选整体移动）' },
  { keys: '拖拽锚点', action: '从节点四向锚点连线，箭头指向目标' },
  { keys: '拖拽分隔条', action: '调整左右面板宽度，双击复位' },
];
