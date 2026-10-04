import { useEffect, useId, useRef } from 'react';
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
    const pathId = `flow-pulse-${useId().replaceAll(':', '')}`;
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
      if (!group) return;

      let currentPath: SVGPathElement | null = null;
      const bindPath = () => {
        const nextPath = group.querySelector<SVGPathElement>('.react-flow__edge-path');
        if (nextPath === currentPath) return;
        currentPath?.removeAttribute('id');
        nextPath?.setAttribute('id', pathId);
        currentPath = nextPath;
      };

      bindPath();
      // 智能边先画原生路径，再用 Worker 的避障结果替换。只监听结构变更，
      // 同一条 path 的 d 变化会由 SVG mpath 自动跟随。
      const observer = new MutationObserver(bindPath);
      observer.observe(group, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        currentPath?.removeAttribute('id');
      };
    }, [active, pathId]);

    return (
      <g ref={groupRef}>
        <SmartEdgeComponent {...props} type={props.type ?? edgeType} data={props.data ?? {}} />
        {active && (
          <circle className={styles.flowPulse}>
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              calcMode="linear"
              keyPoints="0;1;1"
              keyTimes="0;0.72;1"
            >
              <mpath href={`#${pathId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="1;0;0"
              keyTimes="0;0.73;1"
              calcMode="discrete"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </g>
    );
  };
}
