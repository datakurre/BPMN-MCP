/**
 * Post-layout crossing flow detection and reduction.
 *
 * Checks all pairs of connections for segment intersections and reports
 * the count of crossing pairs along with their IDs.
 *
 * Also provides:
 * - Lane-crossing metrics: counts how many sequence flows cross lane
 *   boundaries within a participant pool.
 * - Crossing reduction: attempts to eliminate detected crossings by
 *   nudging waypoints on orthogonal edge segments.
 */

import type { CrossingFlowsResult, LaneCrossingMetrics } from './types';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { segmentsIntersect } from '../geometry';
import { isConnection } from './helpers';
import { deduplicateWaypoints } from './edge-routing-helpers';

/** Nudge offset in pixels when trying to separate crossing edges. */
const CROSSING_NUDGE_PX = 12;

/**
 * Detect crossing sequence flows after layout.
 *
 * Checks all pairs of connections for segment intersections and returns
 * the count of crossing pairs along with their IDs.
 */
export function detectCrossingFlows(elementRegistry: ElementRegistry): CrossingFlowsResult {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      const wpsA = connections[i].waypoints!;
      const wpsB = connections[j].waypoints!;

      let found = false;
      for (let a = 0; a < wpsA.length - 1 && !found; a++) {
        for (let b = 0; b < wpsB.length - 1 && !found; b++) {
          if (segmentsIntersect(wpsA[a], wpsA[a + 1], wpsB[b], wpsB[b + 1])) {
            pairs.push([connections[i].id, connections[j].id]);
            found = true;
          }
        }
      }
    }
  }

  return { count: pairs.length, pairs };
}

// ── Crossing reduction ──────────────────────────────────────────────────────

/**
 * Attempt to reduce edge crossings by nudging waypoints on one of the
 * two crossing edges.
 *
 * Strategy: for each crossing pair, find the crossing segments and try
 * to shift one edge's intermediate vertical segment horizontally by
 * ±CROSSING_NUDGE_PX.  Accept the nudge only if it eliminates the
 * crossing without introducing new ones with other edges.
 *
 * This is a conservative local optimisation — it handles common cases
 * where two orthogonal routes cross at a shared column.  It does NOT
 * reorder ELK layers or move nodes.
 *
 * @returns The number of crossings eliminated.
 */
export function reduceCrossings(elementRegistry: ElementRegistry, modeling: Modeling): number {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  if (connections.length < 2) return 0;

  let eliminated = 0;

  // Build a crossing index: for each connection, which others does it cross?
  const crossingPairs = new Set<string>();
  for (let i = 0; i < connections.length; i++) {
    for (let j = i + 1; j < connections.length; j++) {
      if (edgesCross(connections[i], connections[j])) {
        crossingPairs.add(pairKey(connections[i].id, connections[j].id));
      }
    }
  }

  if (crossingPairs.size === 0) return 0;

  // Try to fix each crossing pair
  for (const key of crossingPairs) {
    const [idA, idB] = key.split('|');
    const connA = elementRegistry.get(idA);
    const connB = elementRegistry.get(idB);
    if (!connA?.waypoints || !connB?.waypoints) continue;

    // Skip if the crossing was already eliminated by a previous fix
    if (!edgesCross(connA, connB)) {
      eliminated++;
      continue;
    }

    // Try nudging connB's internal vertical segments
    if (tryNudgeToAvoidCrossing(connB, connA, connections, modeling)) {
      eliminated++;
      continue;
    }
    // Try nudging connA's internal vertical segments
    if (tryNudgeToAvoidCrossing(connA, connB, connections, modeling)) {
      eliminated++;
    }
  }

  return eliminated;
}

/** Canonical key for a pair of connection IDs. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Check whether two connections have any crossing segments. */
function edgesCross(a: BpmnElement, b: BpmnElement): boolean {
  const wpsA = a.waypoints!;
  const wpsB = b.waypoints!;
  for (let i = 0; i < wpsA.length - 1; i++) {
    for (let j = 0; j < wpsB.length - 1; j++) {
      if (segmentsIntersect(wpsA[i], wpsA[i + 1], wpsB[j], wpsB[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count how many of `allConnections` would cross with `conn` if its
 * waypoints were `candidateWps`.
 */
function countCrossingsWithCandidate(
  candidateWps: Array<{ x: number; y: number }>,
  allConnections: BpmnElement[],
  skipId: string
): number {
  let count = 0;
  for (const other of allConnections) {
    if (other.id === skipId || !other.waypoints) continue;
    const wpsB = other.waypoints;
    let found = false;
    for (let i = 0; i < candidateWps.length - 1 && !found; i++) {
      for (let j = 0; j < wpsB.length - 1 && !found; j++) {
        if (segmentsIntersect(candidateWps[i], candidateWps[i + 1], wpsB[j], wpsB[j + 1])) {
          found = true;
        }
      }
    }
    if (found) count++;
  }
  return count;
}

/**
 * Try to nudge internal vertical segments of `toNudge` so it no longer
 * crosses `crossingWith`.  Only accepts changes that do not increase the
 * total crossing count for `toNudge`.
 *
 * @returns true if a successful nudge was applied.
 */
function tryNudgeToAvoidCrossing(
  toNudge: BpmnElement,
  crossingWith: BpmnElement,
  allConnections: BpmnElement[],
  modeling: Modeling
): boolean {
  const wps = toNudge.waypoints!;
  if (wps.length < 3) return false; // Need at least one internal segment

  const currentCrossings = countCrossingsWithCandidate(
    wps.map((w) => ({ x: w.x, y: w.y })),
    allConnections,
    toNudge.id
  );

  // Try nudging each internal vertical segment
  for (let i = 1; i < wps.length - 1; i++) {
    // An internal point is part of a vertical segment if its X differs
    // from a neighbour by < 2px (near-vertical in orthogonal routes).
    const prevIsVert = Math.abs(wps[i - 1].x - wps[i].x) < 2;
    const nextIsVert = i < wps.length - 1 && Math.abs(wps[i].x - wps[i + 1].x) < 2;

    if (!prevIsVert && !nextIsVert) continue;

    for (const dx of [-CROSSING_NUDGE_PX, CROSSING_NUDGE_PX]) {
      const candidate = wps.map((w) => ({ x: w.x, y: w.y }));

      // Nudge the vertical run: shift all consecutive points sharing
      // the same X as wps[i].
      const baseX = wps[i].x;
      for (let k = 1; k < candidate.length - 1; k++) {
        if (Math.abs(candidate[k].x - baseX) < 2) {
          candidate[k] = { x: candidate[k].x + dx, y: candidate[k].y };
        }
      }

      // Check: does the nudge eliminate the target crossing?
      let stillCrosses = false;
      const wpsB = crossingWith.waypoints!;
      for (let a = 0; a < candidate.length - 1 && !stillCrosses; a++) {
        for (let b = 0; b < wpsB.length - 1 && !stillCrosses; b++) {
          if (segmentsIntersect(candidate[a], candidate[a + 1], wpsB[b], wpsB[b + 1])) {
            stillCrosses = true;
          }
        }
      }
      if (stillCrosses) continue;

      // Check: did we create more crossings overall?
      const newCrossings = countCrossingsWithCandidate(candidate, allConnections, toNudge.id);
      if (newCrossings >= currentCrossings) continue;

      // Accept the nudge
      modeling.updateWaypoints(toNudge, deduplicateWaypoints(candidate));
      return true;
    }
  }

  return false;
}

/**
 * Compute lane-crossing metrics for a diagram.
 *
 * Counts how many sequence flows cross lane boundaries within
 * participant pools. A "lane crossing" occurs when a sequence flow
 * connects two elements assigned to different lanes.
 *
 * Returns overall statistics and per-lane details.
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
