/**
 * Lane crossing metrics: compute how many sequence flows cross lane
 * boundaries within participant pools.
 *
 * Lane crossing analysis utility that works independently of the layout
 * engine. Used for measuring lane coherence after layout.
 */

import type { BpmnElement, ElementRegistry } from '../../bpmn-types';

/** Lane crossing metrics for a diagram's lane organisation. */
export interface LaneCrossingMetrics {
  totalLaneFlows: number;
  crossingLaneFlows: number;
  crossingFlowIds?: string[];
  laneCoherenceScore: number;
}

/**
 * Compute lane-crossing metrics for a diagram.
 *
 * A "lane crossing" occurs when a sequence flow connects two elements
 * assigned to different lanes.  Returns overall statistics including a
 * coherence score (percentage of flows that stay within the same lane).
 *
 * Returns `undefined` if the diagram has no lanes.
 */
export function computeLaneCrossingMetrics(
  elementRegistry: ElementRegistry
): LaneCrossingMetrics | undefined {
  const lanes = elementRegistry.filter((el: BpmnElement) => el.type === 'bpmn:Lane');
  if (lanes.length === 0) return undefined;

  // Build element → lane mapping
  const elementToLane = new Map<string, string>();
  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    for (const ref of refs) {
      elementToLane.set(ref.id, lane.id);
    }
  }

  // Count sequence flows that cross lanes
  const sequenceFlows = elementRegistry.filter(
    (el: BpmnElement) => el.type === 'bpmn:SequenceFlow' && !!el.source && !!el.target
  );

  let totalFlows = 0;
  let crossingFlows = 0;
  const crossingFlowIds: string[] = [];

  for (const flow of sequenceFlows) {
    const sourceLane = elementToLane.get(flow.source!.id);
    const targetLane = elementToLane.get(flow.target!.id);

    // Only count flows where both source and target are in lanes
    if (sourceLane !== undefined && targetLane !== undefined) {
      totalFlows++;
      if (sourceLane !== targetLane) {
        crossingFlows++;
        crossingFlowIds.push(flow.id);
      }
    }
  }

  if (totalFlows === 0) return undefined;

  const coherenceScore = Math.round(((totalFlows - crossingFlows) / totalFlows) * 100);

  return {
    totalLaneFlows: totalFlows,
    crossingLaneFlows: crossingFlows,
    crossingFlowIds: crossingFlowIds.length > 0 ? crossingFlowIds : undefined,
    laneCoherenceScore: coherenceScore,
  };
}
