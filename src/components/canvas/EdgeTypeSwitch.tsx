import { EDGE_TYPES } from '../../lib/edgeTypes';
import type { EdgeType } from '../../lib/edgeTypes';
import styles from './EdgeTypeSwitch.module.css';

interface EdgeTypeSwitchProps {
  value: EdgeType;
  onChange: (value: EdgeType) => void;
}

/** 连线样式三选一。切换后通过 defaultEdgeOptions 同时作用于已有连线与新连线。 */
export default function EdgeTypeSwitch({ value, onChange }: EdgeTypeSwitchProps) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="连线样式">
      {EDGE_TYPES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={styles.option}
          data-active={value === option.value ? '' : undefined}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
