/**
 * Post-layout crossing flow detection.
 *
 * Checks all pairs of connections for segment intersections and reports
 * the count of crossing pairs along with their IDs.
 *
 * Also provides:
 * - Lane-crossing metrics: counts how many sequence flows cross lane
 *   boundaries within a participant pool.
 */

import type { CrossingFlowsResult, LaneCrossingMetrics } from './types';
import type { BpmnElement, ElementRegistry } from '../bpmn-types';
import { segmentsIntersect } from '../geometry';
import { isConnection } from './helpers';

// ── H1: Orthogonal segment classification ──────────────────────────────────

/**
 * Maximum deviation (px) for a segment endpoint to still be classified as
 * horizontal (|dy| ≤ this) or vertical (|dx| ≤ this).  After the final
 * orthogonal snap pass, nearly all BPMN routes fall within this tolerance.
 * Remaining diagonal segments use the pairwise fallback.
 */
const ORTHO_CLASS_TOLERANCE = 3;

/** A horizontal segment (constant Y) extracted from a connection's waypoints. */
interface HOrthoSeg {
  y: number; // fixed Y coordinate (average of endpoints)
  x1: number; // left bound (min X)
  x2: number; // right bound (max X)
  connId: string;
}

/** A vertical segment (constant X) extracted from a connection's waypoints. */
interface VOrthoSeg {
  x: number; // fixed X coordinate (average of endpoints)
  y1: number; // top bound (min Y)
  y2: number; // bottom bound (max Y)
  connId: string;
}

/**
 * Classify every waypoint-segment in each connection as horizontal, vertical,
 * or general (diagonal / too short to matter).
 *
 * @returns hSegs - horizontal segments (sorted externally by caller)
 *          vSegs - vertical segments
 *          generalConnIds - connection IDs that have at least one diagonal segment
 */
function classifyConnectionSegments(connections: BpmnElement[]): {
  hSegs: HOrthoSeg[];
  vSegs: VOrthoSeg[];
  generalConnIds: Set<string>;
} {
  const hSegs: HOrthoSeg[] = [];
  const vSegs: VOrthoSeg[] = [];
  const generalConnIds = new Set<string>();

  for (const conn of connections) {
    const wps = conn.waypoints!;
    for (let i = 0; i < wps.length - 1; i++) {
      const p1 = wps[i];
      const p2 = wps[i + 1];
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);

      if (dy <= ORTHO_CLASS_TOLERANCE && dx > ORTHO_CLASS_TOLERANCE) {
        // Horizontal segment
        hSegs.push({
          y: (p1.y + p2.y) / 2,
          x1: Math.min(p1.x, p2.x),
          x2: Math.max(p1.x, p2.x),
          connId: conn.id,
        });
      } else if (dx <= ORTHO_CLASS_TOLERANCE && dy > ORTHO_CLASS_TOLERANCE) {
        // Vertical segment
        vSegs.push({
          x: (p1.x + p2.x) / 2,
          y1: Math.min(p1.y, p2.y),
          y2: Math.max(p1.y, p2.y),
          connId: conn.id,
        });
      } else if (dx > ORTHO_CLASS_TOLERANCE || dy > ORTHO_CLASS_TOLERANCE) {
        // Non-trivial diagonal — needs pairwise fallback
        generalConnIds.add(conn.id);
      }
      // Very short segments (both dx and dy tiny) are irrelevant — skip
    }
  }

  return { hSegs, vSegs, generalConnIds };
}

/**
 * Binary search: first index in `arr` (sorted by `.y` ascending) where
 * `arr[i].y >= y`.  Returns `arr.length` if none.
 */
function lowerBoundY(arr: HOrthoSeg[], y: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].y < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Minimum interior margin (px) for the sweep-line crossing check.
 *
 * A V segment (x, [y1, y2]) and an H segment (y, [x1, x2]) are counted as
 * crossing only if the H segment's Y is **strictly interior** to the V's Y
 * range, and the V segment's X is **strictly interior** to the H's X range.
 *
 * This matches the strict cross-product test in `segmentsIntersect`, which
 * returns false when one segment's endpoint lies exactly on the other segment
 * (T-junction / endpoint touch).  For BPMN (integer coordinates after the
 * final orthogonal snap), 0.5 px cleanly separates endpoint touches from
 * genuine interior crossings.
 */
const SWEEP_INTERIOR_MARGIN = 0.5;

/**
 * Detect crossing sequence flows after layout.
 *
 * **H1 — O(n log n) sweep-line for orthogonal segments:**
 *
 * For orthogonal routing (segments are strictly horizontal or vertical),
 * a crossing can only occur between one H segment and one V segment —
 * two H segments are parallel and two V segments are parallel.
 *
 * Algorithm:
 * 1. Classify every waypoint-segment as H, V, or general (diagonal).
 * 2. Sort all H segments by Y.
 * 3. For each V segment (x, y1, y2): binary-search for H segments with
 *    y strictly in (y1, y2), then check whether the V segment's X falls
 *    strictly within the H segment's (x1, x2) range.  O(log n + k) per V.
 * 4. For connections that have any diagonal segment (rare after the final
 *    orthogonal snap), fall back to the original pairwise check.
 *
 * "Strictly interior" means we use SWEEP_INTERIOR_MARGIN to exclude
 * endpoint touches (T-junctions), matching the behaviour of
 * `segmentsIntersect` which uses the strict cross-product test.
 *
 * Total: O((n + k) log n) where n = total segments, k = crossing count.
 * For sparse crossings (typical BPMN) this is effectively O(n log n).
 */
export function detectCrossingFlows(elementRegistry: ElementRegistry): CrossingFlowsResult {
  const connections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.waypoints && el.waypoints.length >= 2
  );

  if (connections.length === 0) return { count: 0, pairs: [] };

  const { hSegs, vSegs, generalConnIds } = classifyConnectionSegments(connections);

  // Sort H segments by Y so we can binary-search for each V segment's Y range
  hSegs.sort((a, b) => a.y - b.y);

  const crossingPairSet = new Set<string>();

  // Fast path: H × V sweep-line for orthogonal segments.
  // Uses SWEEP_INTERIOR_MARGIN to exclude endpoint touches (T-junctions),
  // matching the strict cross-product test used by `segmentsIntersect`.
  for (const vSeg of vSegs) {
    // Binary-search for first H seg with y strictly above vSeg.y1 (interior only)
    const lo = lowerBoundY(hSegs, vSeg.y1 + SWEEP_INTERIOR_MARGIN);
    for (let i = lo; i < hSegs.length; i++) {
      const hSeg = hSegs[i];
      // Stop when H segment's Y is no longer strictly below vSeg.y2
      if (hSeg.y >= vSeg.y2 - SWEEP_INTERIOR_MARGIN) break;
      if (hSeg.connId === vSeg.connId) continue; // Same connection — not a crossing
      // V's X must be strictly inside H's X range (not at either endpoint)
      if (hSeg.x1 + SWEEP_INTERIOR_MARGIN <= vSeg.x && vSeg.x <= hSeg.x2 - SWEEP_INTERIOR_MARGIN) {
        crossingPairSet.add(pairKey(hSeg.connId, vSeg.connId));
      }
    }
  }

  // Fallback: pairwise check for connections with diagonal segments
  if (generalConnIds.size > 0) {
    const genConns = connections.filter((c) => generalConnIds.has(c.id));
    for (const genConn of genConns) {
      for (const other of connections) {
        if (genConn.id === other.id) continue;
        const key = pairKey(genConn.id, other.id);
        if (crossingPairSet.has(key)) continue; // Already detected
        if (edgesCross(genConn, other)) {
          crossingPairSet.add(key);
        }
      }
    }
  }

  const pairs: Array<[string, string]> = Array.from(crossingPairSet).map((key) => {
    const sep = key.indexOf('|');
    return [key.slice(0, sep), key.slice(sep + 1)] as [string, string];
  });

  return { count: pairs.length, pairs };
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
