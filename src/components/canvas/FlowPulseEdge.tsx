import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { useStore } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

import styles from './FlowCanvas.module.css';

type SmartEdgeRenderProps = EdgeProps & { type: string; data: Record<string, unknown> };

/**
 * 只在选中边或其任一端点节点时挂载红点。SVG 自己沿当前边路径做动画，
 * 不开定时器，也不在每帧读取路径或更新 React 状态。
 */
export function withFlowPulse(
  SmartEdgeComponent: ComponentType<SmartEdgeRenderProps>,
  edgeType: string,
) {
  return function FlowPulseEdge(props: EdgeProps) {
    const groupRef = useRef<SVGGElement>(null);
    const pulseRef = useRef<SVGPathElement>(null);
    const touchesSelectedNode = useStore((state) =>
      Boolean(
        state.nodeLookup.get(props.source)?.selected ||
        state.nodeLookup.get(props.target)?.selected,
      ),
    );
    const active = Boolean(props.selected || touchesSelectedNode);

    useEffect(() => {
      if (!active) return;
      const group = groupRef.current;
      const pulse = pulseRef.current;
      if (!group || !pulse) return;

      const bindPath = () => {
        const drawn = group.querySelector<SVGPathElement>('.react-flow__edge-path');
        const nextD = drawn?.getAttribute('d') ?? '';
        if (pulse.getAttribute('d') !== nextD) pulse.setAttribute('d', nextD);
      };

      bindPath();
      // 智能边先画原生路径，再用 Worker 的避障结果替换；路径也可能在拖动时改写 d。
      // 仅活动边同步这些变化，不在动画的每一帧运行 JavaScript。
      const observer = new MutationObserver(bindPath);
      observer.observe(group, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['d'],
      });
      return () => observer.disconnect();
    }, [active]);

    return (
      <g ref={groupRef}>
        <SmartEdgeComponent {...props} type={props.type ?? edgeType} data={props.data ?? {}} />
        {active && (
          <path ref={pulseRef} className={styles.flowPulse} data-flow-pulse="" aria-hidden="true" />
        )}
      </g>
    );
  };
}
