/**
 * Post-ELK lane repositioning.
 *
 * Lanes are excluded from the ELK graph (they are structural containers,
 * not flow nodes). After ELK lays out the flow elements within a
 * participant pool, this module:
 *
 * 1. Shifts flow nodes vertically so that each lane's nodes occupy a
 *    separate Y-band (ELK places them all on one row).
 * 2. Resizes the participant pool to encompass all lane bands.
 * 3. Positions and resizes each lane to tile vertically inside the pool.
 *
 * Lane–flow-node assignment comes from the BPMN model's
 * `bpmn:Lane.flowNodeRef` collection, which bpmn-js preserves in
 * `lane.businessObject.flowNodeRef`.
 *
 * **Important:** The `flowNodeRef` arrays get mutated by bpmn-js when
 * `modeling.moveElements` shifts nodes across lane boundaries.  The
 * original assignments must be captured **before** any layout passes
 * via `saveLaneNodeAssignments()` and passed in to `repositionLanes()`.
 */

/** Saved lane → node ID mapping, keyed by lane ID. */
export type LaneNodeAssignments = Map<string, Set<string>>;

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import {
  ELK_MIN_LANE_HEIGHT,
  ELK_MIN_LANE_WIDTH,
  POOL_LABEL_BAND,
  LANE_VERTICAL_PADDING,
  LANE_HORIZONTAL_PADDING,
} from '../constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/** Returns true for types that should not be assigned to lanes. */
function isLaneOrInfrastructure(type: string): boolean {
  return (
    isLane(type) ||
    isInfrastructure(type) ||
    isConnection(type) ||
    isArtifact(type) ||
    type === 'bpmn:BoundaryEvent' ||
    type === 'label'
  );
}

/**
 * Saved lane metadata: original Y-position (from DI coordinates)
 * and assigned flow node IDs.
 */
export interface LaneSnapshot {
  laneId: string;
  originalY: number;
  /** Original X-position (for sorting left-to-right in vertical/DOWN layouts, F5). */
  originalX: number;
  nodeIds: Set<string>;
}

/**
 * Capture lane → flow-node assignments before layout mutates them.
 *
 * bpmn-js's `modeling.moveElements` updates `lane.businessObject.flowNodeRef`
 * when a node crosses lane boundaries.  This function snapshots the original
 * assignments so `repositionLanes()` can use them later.
 *
 * Call this **before** any ELK layout passes (before `applyElkPositions`).
 */
export function saveLaneNodeAssignments(elementRegistry: ElementRegistry): LaneSnapshot[] {
  const snapshots: LaneSnapshot[] = [];
  const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane');

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    snapshots.push({
      laneId: lane.id,
      originalY: lane.y,
      originalX: lane.x,
      nodeIds,
    });
  }

  return snapshots;
}

/**
 * Reposition lanes and their flow nodes inside participant pools after
 * ELK layout.
 *
 * ELK treats all flow nodes in a pool as a flat graph without lane
 * awareness.  After ELK positioning (and centreElementsInPools), all
 * nodes sit on roughly the same row.  This function separates them
 * into distinct vertical bands — one per lane — so the final layout
 * shows clear lane boundaries.
 *
 * **F5 — direction-aware:** When `direction` is `'DOWN'` or `'UP'`, lanes
 * are arranged as left-to-right columns instead of top-to-bottom rows.
 * This matches the expected layout for vertical (top-to-bottom) processes
 * where each swimlane represents a column of work.
 *
 * @param savedAssignments  Lane snapshots from `saveLaneNodeAssignments()`,
 *   captured before layout.  If empty/undefined, falls back to reading
 *   the (possibly mutated) `flowNodeRef` from the business objects.
 * @param laneStrategy  Optional lane order optimisation strategy.
 * @param direction  ELK layout direction; 'DOWN'/'UP' activates column mode (F5).
 */
export function repositionLanes(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  savedAssignments?: LaneSnapshot[],
  laneStrategy?: 'preserve' | 'optimize',
  direction?: string
): void {
  const participants = elementRegistry.filter((el) => el.type === 'bpmn:Participant');
  const isVertical = direction === 'DOWN' || direction === 'UP';

  for (const pool of participants) {
    const lanes = elementRegistry.filter((el) => el.type === 'bpmn:Lane' && el.parent === pool);

    if (lanes.length === 0) continue;

    // F5: For vertical (DOWN/UP) layouts, arrange lanes as left-to-right columns.
    if (isVertical) {
      repositionLanesAsColumns(
        pool,
        lanes,
        elementRegistry,
        modeling,
        savedAssignments,
        laneStrategy
      );
      continue;
    }

    // Build lane → flow node IDs mapping.
    // Prefer saved assignments (captured before layout mutated flowNodeRef).
    const laneNodeMap = new Map<string, Set<string>>();
    let orderedLanes: BpmnElement[];

    if (savedAssignments && savedAssignments.length > 0) {
      // Filter saved snapshots to lanes in this pool
      const poolLaneIds = new Set(lanes.map((l) => l.id));
      const poolSnapshots = savedAssignments.filter((s) => poolLaneIds.has(s.laneId));

      // Sort lanes by their original DI Y-position (before layout moved them)
      const originalYMap = new Map<string, number>();
      for (const snap of poolSnapshots) {
        laneNodeMap.set(snap.laneId, snap.nodeIds);
        originalYMap.set(snap.laneId, snap.originalY);
      }

      orderedLanes = [...lanes].sort((a, b) => {
        const ya = originalYMap.get(a.id) ?? a.y;
        const yb = originalYMap.get(b.id) ?? b.y;
        return ya - yb;
      });
    } else {
      // Fallback: read from (possibly mutated) flowNodeRef
      const fallbackMap = buildLaneNodeMap(lanes, elementRegistry);
      for (const [k, v] of fallbackMap) laneNodeMap.set(k, v);
      orderedLanes = [...lanes].sort((a, b) => a.y - b.y);
    }

    // Skip if no lane has any assigned nodes
    const hasNodes = Array.from(laneNodeMap.values()).some((s) => s.size > 0);
    if (!hasNodes) continue;

    // Auto-assign orphaned flow nodes to the nearest lane by Y-centre distance.
    const assignedIdsRow = new Set([...laneNodeMap.values()].flatMap((s) => [...s]));
    for (const orphan of elementRegistry.filter(
      (el: BpmnElement) =>
        el.parent === pool && !isLaneOrInfrastructure(el.type) && !assignedIdsRow.has(el.id)
    )) {
      const cy = orphan.y + (orphan.height || 0) / 2;
      const best = orderedLanes.reduce((b, l) =>
        Math.abs(l.y + l.height / 2 - cy) < Math.abs(b.y + b.height / 2 - cy) ? l : b
      );
      laneNodeMap.get(best.id)?.add(orphan.id);
    }

    // Optimize lane order to minimise cross-lane flows if requested
    if (laneStrategy === 'optimize' && orderedLanes.length > 1) {
      orderedLanes = optimizeLaneOrder(orderedLanes, laneNodeMap, elementRegistry);
    }

    // F2: Compute actual Y-span of lane content for correct multi-row heights.
    // The previous approach used max(element_height) which under-sized lanes
    // containing stacked elements (e.g. a subprocess above a task).  Using
    // the full ELK-assigned Y-span preserves relative vertical positions and
    // allocates enough band height for all rows within the lane.
    const laneContentHeight = new Map<string, number>();
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) {
        laneContentHeight.set(lane.id, 0);
        continue;
      }
      let minTop = Infinity;
      let maxBottom = -Infinity;
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) {
          const top = shape.y ?? 0;
          const bottom = top + (shape.height || 0);
          if (top < minTop) minTop = top;
          if (bottom > maxBottom) maxBottom = bottom;
        }
      }
      laneContentHeight.set(lane.id, minTop === Infinity ? 0 : maxBottom - minTop);
    }

    // Compute lane band heights (content height + vertical padding, min enforced)
    const laneBandHeights = new Map<string, number>();
    for (const lane of orderedLanes) {
      const contentH = laneContentHeight.get(lane.id) || 0;
      const bandH = Math.max(contentH + LANE_VERTICAL_PADDING * 2, ELK_MIN_LANE_HEIGHT);
      laneBandHeights.set(lane.id, bandH);
    }

    // Total minimum height for all lane bands
    const totalLaneHeight = Array.from(laneBandHeights.values()).reduce((a, b) => a + b, 0);

    const poolX = pool.x;
    const poolY = pool.y;
    const poolWidth = pool.width;

    const newPoolHeight = totalLaneHeight;

    // Compute Y-band for each lane
    const laneBandY = new Map<string, number>();
    let currentBandY = poolY;
    for (const lane of orderedLanes) {
      laneBandY.set(lane.id, currentBandY);
      currentBandY += laneBandHeights.get(lane.id)!;
    }

    // Move flow nodes into their lane's Y-band.
    // Each node is vertically centred in its lane band.
    for (const lane of orderedLanes) {
      const nodeIds = laneNodeMap.get(lane.id);
      if (!nodeIds || nodeIds.size === 0) continue;

      const bandY = laneBandY.get(lane.id)!;
      const bandH = laneBandHeights.get(lane.id)!;

      const shapes: BpmnElement[] = [];
      for (const nodeId of nodeIds) {
        const shape = elementRegistry.get(nodeId);
        if (shape) shapes.push(shape);
      }

      if (shapes.length === 0) continue;

      // Compute median Y-centre of the lane's nodes (they are likely
      // on the same row after ELK + centreElementsInPools)
      const sortedYC = shapes.map((s) => s.y + (s.height || 0) / 2).sort((a, b) => a - b);
      const dy = Math.round(bandY + bandH / 2 - sortedYC[Math.floor(sortedYC.length / 2)]);

      // Lane-boundary guards: clamp so no element overshoots above or below the band.
      const topY = Math.min(...shapes.map((s) => s.y));
      const botY = Math.max(...shapes.map((s) => s.y + (s.height || 0)));
      const safeDy = Math.min(topY + dy < bandY ? bandY - topY : dy, bandY + bandH - botY);
      if (Math.abs(safeDy) > 1) modeling.moveElements(shapes, { x: 0, y: safeDy });
    }

    // Position and resize each lane to tile vertically inside the pool.
    // Resize lanes FIRST, then correct the pool height.  Doing the pool
    // resize first would cause bpmn-js to proportionally redistribute
    // lanes, distorting the target heights.
    const laneX = poolX + POOL_LABEL_BAND;
    const laneWidth = poolWidth - POOL_LABEL_BAND;

    for (const lane of orderedLanes) {
      const targetY = laneBandY.get(lane.id)!;
      const targetH = laneBandHeights.get(lane.id)!;

      // Resize lane to target dimensions
      modeling.resizeShape(lane, {
        x: laneX,
        y: targetY,
        width: laneWidth,
        height: targetH,
      });
    }

    // Correct pool height to match the sum of lane bands.
    // bpmn-js auto-adjusts the pool during lane resizing, but the
    // cumulative result may not exactly equal totalLaneHeight.
    const updatedPool = elementRegistry.get(pool.id)!;
    if (Math.abs(updatedPool.height - newPoolHeight) > 1) {
      modeling.resizeShape(updatedPool, {
        x: updatedPool.x,
        y: updatedPool.y,
        width: updatedPool.width,
        height: newPoolHeight,
      });
    }

    // Re-verify lanes: pool resize may have redistributed them.
    // A single correction pass is sufficient.
    for (const lane of orderedLanes) {
      const current = elementRegistry.get(lane.id)!;
      const targetY = laneBandY.get(lane.id)!;
      const targetH = laneBandHeights.get(lane.id)!;
      if (Math.abs(current.height - targetH) > 2 || Math.abs(current.y - targetY) > 2) {
        modeling.resizeShape(current, {
          x: current.x,
          y: targetY,
          width: current.width,
          height: targetH,
        });
      }
    }
  }
}

/**
 * F5 — Reposition lanes as left-to-right columns for vertical (DOWN/UP) layouts.
 *
 * When the ELK layout direction is DOWN or UP, swimlanes should appear as
 * vertical columns side by side instead of horizontal rows stacked top-to-bottom.
 * Each column receives elements from one lane, centred horizontally within the column.
 *
 * Column widths are computed from the X-span of each lane's content plus padding.
 * The pool width is adjusted to accommodate the total column width + pool label band.
 * The pool height is set to encompass the deepest column content.
 */
function repositionLanesAsColumns(
  pool: BpmnElement,
  lanes: BpmnElement[],
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  savedAssignments?: LaneSnapshot[],
  laneStrategy?: 'preserve' | 'optimize'
): void {
  // Build lane → node assignment map
  const laneNodeMap = new Map<string, Set<string>>();
  let orderedLanes: BpmnElement[];

  if (savedAssignments && savedAssignments.length > 0) {
    const poolLaneIds = new Set(lanes.map((l) => l.id));
    const poolSnapshots = savedAssignments.filter((s) => poolLaneIds.has(s.laneId));

    const originalXMap = new Map<string, number>();
    const originalYMap = new Map<string, number>();
    for (const snap of poolSnapshots) {
      laneNodeMap.set(snap.laneId, snap.nodeIds);
      originalXMap.set(snap.laneId, snap.originalX);
      originalYMap.set(snap.laneId, snap.originalY);
    }

    // Sort by original X-position (left-to-right column order).
    // When lanes were originally stacked top-to-bottom (same X, different Y),
    // fall back to originalY so the top lane becomes the left column and
    // the bottom lane becomes the right column — preserving visual reading order.
    orderedLanes = [...lanes].sort((a, b) => {
      const xa = originalXMap.get(a.id) ?? a.x;
      const xb = originalXMap.get(b.id) ?? b.x;
      if (Math.abs(xa - xb) > 10) return xa - xb;
      // Same X — sort by original Y (top row → left column)
      const ya = originalYMap.get(a.id) ?? a.y;
      const yb = originalYMap.get(b.id) ?? b.y;
      return ya - yb;
    });
  } else {
    const fallbackMap = buildLaneNodeMap(lanes, elementRegistry);
    for (const [k, v] of fallbackMap) laneNodeMap.set(k, v);
    orderedLanes = [...lanes].sort((a, b) => a.x - b.x);
  }

  const hasNodes = Array.from(laneNodeMap.values()).some((s) => s.size > 0);
  if (!hasNodes) return;

  // Auto-assign orphaned flow nodes to the nearest lane by X-centre distance.
  const assignedIdsCol = new Set([...laneNodeMap.values()].flatMap((s) => [...s]));
  for (const orphan of elementRegistry.filter(
    (el: BpmnElement) =>
      el.parent === pool && !isLaneOrInfrastructure(el.type) && !assignedIdsCol.has(el.id)
  )) {
    const cx = orphan.x + (orphan.width || 0) / 2;
    const best = orderedLanes.reduce((b, l) =>
      Math.abs(l.x + l.width / 2 - cx) < Math.abs(b.x + b.width / 2 - cx) ? l : b
    );
    laneNodeMap.get(best.id)?.add(orphan.id);
  }

  if (laneStrategy === 'optimize' && orderedLanes.length > 1) {
    orderedLanes = optimizeLaneOrder(orderedLanes, laneNodeMap, elementRegistry);
  }

  // Compute column (band) widths — content X-span + padding, minimum ELK_MIN_LANE_WIDTH
  const laneBandWidths = new Map<string, number>();
  for (const lane of orderedLanes) {
    const nodeIds = laneNodeMap.get(lane.id);
    if (!nodeIds || nodeIds.size === 0) {
      laneBandWidths.set(lane.id, ELK_MIN_LANE_WIDTH);
      continue;
    }
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (const nodeId of nodeIds) {
      const shape = elementRegistry.get(nodeId);
      if (shape) {
        const left = shape.x ?? 0;
        const right = left + (shape.width || 0);
        if (left < minLeft) minLeft = left;
        if (right > maxRight) maxRight = right;
      }
    }
    const contentW = minLeft === Infinity ? 0 : maxRight - minLeft;
    laneBandWidths.set(
      lane.id,
      Math.max(contentW + LANE_HORIZONTAL_PADDING * 2, ELK_MIN_LANE_WIDTH)
    );
  }

  const totalLaneWidth = Array.from(laneBandWidths.values()).reduce((a, b) => a + b, 0);
  const newPoolWidth = totalLaneWidth + POOL_LABEL_BAND;

  const poolX = pool.x;
  const poolY = pool.y;
  const poolHeight = pool.height;

  // Compute X-band start positions for each lane column
  const laneBandX = new Map<string, number>();
  let currentBandX = poolX + POOL_LABEL_BAND;
  for (const lane of orderedLanes) {
    laneBandX.set(lane.id, currentBandX);
    currentBandX += laneBandWidths.get(lane.id)!;
  }

  // Move flow nodes into their lane's X-band (centre horizontally)
  for (const lane of orderedLanes) {
    const nodeIds = laneNodeMap.get(lane.id);
    if (!nodeIds || nodeIds.size === 0) continue;

    const bandX = laneBandX.get(lane.id)!;
    const bandW = laneBandWidths.get(lane.id)!;
    const bandCentreX = bandX + bandW / 2;

    const shapes: BpmnElement[] = [];
    for (const nodeId of nodeIds) {
      const shape = elementRegistry.get(nodeId);
      if (shape) shapes.push(shape);
    }
    if (shapes.length === 0) continue;

    const xCentres = shapes.map((s) => s.x + (s.width || 0) / 2);
    xCentres.sort((a, b) => a - b);
    const medianCentre = xCentres[Math.floor(xCentres.length / 2)];
    const dx = Math.round(bandCentreX - medianCentre);

    if (Math.abs(dx) > 1) {
      modeling.moveElements(shapes, { x: dx, y: 0 });
    }
  }

  // ⚠ F5 — Direct DI mutation for lane column positioning (J3 command-stack bypass).
  //
  // bpmn-js's ResizeLanes / LaneDropBehavior enforces that all lanes within a pool
  // share the same x-position and width (horizontal-row model).  Calling
  // modeling.resizeShape(lane, { x: targetX, width: targetW }) triggers these
  // behaviors, which immediately redistribute lanes back to equal-width rows,
  // destroying the column layout we just computed.
  //
  // Solution: bypass the command stack and mutate lane/pool positions directly,
  // identically to how boundary events are repositioned in boundary-positioning.ts.
  // This is safe here because:
  //   (a) repositionLanesAsColumns is only called during a full layout pass, which
  //       already bypasses the undo stack for element moves.
  //   (b) The BPMN XML export reads from di.bounds, which we also update.
  const laneHeight = Math.max(poolHeight, ELK_MIN_LANE_HEIGHT);

  for (const lane of orderedLanes) {
    const targetX = laneBandX.get(lane.id)!;
    const targetW = laneBandWidths.get(lane.id)!;
    const currentLane = elementRegistry.get(lane.id)!;

    currentLane.x = targetX;
    currentLane.y = poolY;
    currentLane.width = targetW;
    currentLane.height = laneHeight;

    if (currentLane.di?.bounds) {
      currentLane.di.bounds.x = targetX;
      currentLane.di.bounds.y = poolY;
      currentLane.di.bounds.width = targetW;
      currentLane.di.bounds.height = laneHeight;
    }
  }

  // Adjust pool width to encompass all columns (pool resize is safe since it
  // doesn't trigger lane redistribution in the same way lane resizes do).
  const updatedPool = elementRegistry.get(pool.id)!;
  if (Math.abs(updatedPool.width - newPoolWidth) > 1) {
    updatedPool.width = newPoolWidth;
    if (updatedPool.di?.bounds) {
      updatedPool.di.bounds.width = newPoolWidth;
    }
  }
  // Mark pool as column-mode so downstream steps (compactPools) skip lane resizing.
  (updatedPool as any)._columnLanes = true;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a map of lane ID → set of flow node element IDs.
 *
 * Uses the BPMN model's `lane.businessObject.flowNodeRef` which contains
 * references to the flow node business objects assigned to each lane.
 */
function buildLaneNodeMap(
  lanes: BpmnElement[],
  elementRegistry: ElementRegistry
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const lane of lanes) {
    const bo = lane.businessObject;
    const refs = (bo?.flowNodeRef || []) as Array<{ id: string }>;
    const nodeIds = new Set<string>();

    for (const ref of refs) {
      // flowNodeRef contains business objects; find the corresponding shape
      const shape = elementRegistry.get(ref.id);
      if (shape) {
        nodeIds.add(shape.id);
      }
    }

    // Always register the lane, even if empty — consistent with the
    // saved-assignment path so empty lanes get positioned correctly.
    map.set(lane.id, nodeIds);
  }

  return map;
}
/**
 * Compute the number of cross-lane sequence flow "crossings" for a
 * given lane ordering.
 *
 * A crossing occurs when a sequence flow goes from lane at index i
 * to lane at index j, and another flow goes from lane at index k to
 * lane at index l, where (i < k && j > l) or (i > k && j < l).
 *
 * Additionally, we penalise "long" jumps: a flow between lane i and
 * lane j costs |i - j| (adjacent = 1, skip-one = 2, etc.).  This
 * prefers orderings where connected lanes are adjacent.
 */
function computeLaneCrossingCost(
  laneOrder: BpmnElement[],
  adjacencyPairs: Array<[string, string]>
): number {
  const laneIndex = new Map<string, number>();
  for (let i = 0; i < laneOrder.length; i++) {
    laneIndex.set(laneOrder[i].id, i);
  }

  // Sum of distances: prefer adjacent connected lanes
  let cost = 0;
  for (const [srcLane, tgtLane] of adjacencyPairs) {
    const si = laneIndex.get(srcLane);
    const ti = laneIndex.get(tgtLane);
    if (si !== undefined && ti !== undefined) {
      cost += Math.abs(si - ti);
    }
  }
  return cost;
}

/**
 * Optimise lane order to minimise the total distance of cross-lane
 * sequence flows.  Uses a greedy adjacent-swap approach (bubble sort
 * style) which is efficient for the typical 2–6 lanes.
 *
 * For ≤ 8 lanes, tries all permutations (8! = 40 320).
 * For > 8 lanes (rare), uses greedy adjacent swaps.
 */
function optimizeLaneOrder(
  lanes: BpmnElement[],
  laneNodeMap: Map<string, Set<string>>,
  elementRegistry: ElementRegistry
): BpmnElement[] {
  // Build adjacency pairs: (sourceLaneId, targetLaneId) for each
  // cross-lane sequence flow.
  const nodeToLane = new Map<string, string>();
  for (const [laneId, nodeIds] of laneNodeMap) {
    for (const nodeId of nodeIds) {
      nodeToLane.set(nodeId, laneId);
    }
  }

  const adjacencyPairs: Array<[string, string]> = [];
  const sequenceFlows = elementRegistry.filter(
    (el: BpmnElement) => el.type === 'bpmn:SequenceFlow' && !!el.source && !!el.target
  );

  for (const flow of sequenceFlows) {
    const srcLane = nodeToLane.get(flow.source!.id);
    const tgtLane = nodeToLane.get(flow.target!.id);
    if (srcLane && tgtLane && srcLane !== tgtLane) {
      adjacencyPairs.push([srcLane, tgtLane]);
    }
  }

  // No cross-lane flows — order doesn't matter, keep original
  if (adjacencyPairs.length === 0) return lanes;

  if (lanes.length <= 6) {
    // Brute-force: try all permutations (≤6 lanes = 720 permutations max).
    // Threshold reduced from 8 (40 320 permutations) to 6 for performance;
    // 7+ lane diagrams fall back to the greedy adjacent-swap below.
    return bruteForceOptimal(lanes, adjacencyPairs);
  }

  // Greedy adjacent-swap optimisation
  const order = [...lanes];
  let bestCost = computeLaneCrossingCost(order, adjacencyPairs);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      // Try swapping adjacent lanes
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
      const newCost = computeLaneCrossingCost(order, adjacencyPairs);
      if (newCost < bestCost) {
        bestCost = newCost;
        improved = true;
      } else {
        // Swap back
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    }
  }

  return order;
}

/**
 * Try all permutations and return the one with the lowest crossing cost.
 */
function bruteForceOptimal(
  lanes: BpmnElement[],
  adjacencyPairs: Array<[string, string]>
): BpmnElement[] {
  let bestOrder = lanes;
  let bestCost = computeLaneCrossingCost(lanes, adjacencyPairs);

  function permute(arr: BpmnElement[], start: number): void {
    if (start === arr.length) {
      const cost = computeLaneCrossingCost(arr, adjacencyPairs);
      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = [...arr];
      }
      return;
    }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(arr, start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }

  permute([...lanes], 0);
  return bestOrder;
}
