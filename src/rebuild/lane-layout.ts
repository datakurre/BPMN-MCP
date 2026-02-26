/**
 * Lane layout utilities for the rebuild-based layout engine.
 *
 * After elements are positioned by the main rebuild engine
 * (correct X ordering, default Y), lane-aware adjustments
 * move elements vertically into their assigned lane bands and
 * resize lanes/pool to fit the content.
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default height (px) for each lane in a pool.
 * Matches typical BPMN lane sizing in Camunda Modeler.
 * Exported so the rebuild engine can use it for lane-aware Y pre-positioning.
 */
export const DEFAULT_LANE_HEIGHT = 250;

/**
 * Minimum lane height (px) even for empty / sparse lanes.
 */
const MIN_LANE_HEIGHT = 120;

/**
 * Width (px) of the pool's left header strip.
 * Lanes start after this strip.
 */
const POOL_HEADER_WIDTH = 30;

/** BPMN type string for sequence flows (used in multiple filters). */
const SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';

// ── Lane detection ─────────────────────────────────────────────────────────

/**
 * Get all lane elements within a participant pool.
 */
export function getLanesForParticipant(
  registry: ElementRegistry,
  participant: BpmnElement
): BpmnElement[] {
  const allElements: BpmnElement[] = registry.getAll();
  return allElements.filter((el) => el.type === 'bpmn:Lane' && isDescendantOf(el, participant));
}

/** Check if an element is a descendant of an ancestor element. */
function isDescendantOf(el: BpmnElement, ancestor: BpmnElement): boolean {
  let current = el.parent;
  while (current) {
    if (current.id === ancestor.id) return true;
    current = current.parent;
  }
  return false;
}

// ── Lane assignment mapping ────────────────────────────────────────────────

/**
 * Build a mapping of element ID → lane for elements within a pool.
 * Uses each lane's businessObject.flowNodeRef to determine membership.
 */
export function buildElementToLaneMap(lanes: BpmnElement[]): Map<string, BpmnElement> {
  const elementToLane = new Map<string, BpmnElement>();

  for (const lane of lanes) {
    const refs = lane.businessObject?.flowNodeRef;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (ref?.id) {
        elementToLane.set(ref.id, lane);
      }
    }
  }

  return elementToLane;
}

/**
 * Build a map from element ID to estimated lane center Y.
 *
 * Used by the rebuild engine to pre-compute lane-aware Y positions
 * before calling computePositions().  Elements with a known lane
 * will be positioned at their lane's estimated center Y rather than
 * at their predecessor's Y (tasks 3a and 3c).
 *
 * The estimate is based on the topological lane order (sorted by
 * current Y) and the default lane height.  The actual lane heights
 * are computed later by resizePoolAndLanes() / handleAutosizePoolsAndLanes().
 *
 * @param lanes       All lane elements in the participant.
 * @param savedLaneMap  Element-ID → lane mapping captured before rebuild.
 * @param originY     Y origin for the first lane (matches rebuildLayout origin.y).
 */
export function buildElementLaneYMap(
  lanes: BpmnElement[],
  savedLaneMap: Map<string, BpmnElement>,
  originY: number
): Map<string, number> {
  if (lanes.length === 0 || savedLaneMap.size === 0) return new Map();

  // Sort lanes by current Y position to get top-to-bottom order.
  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);

  // Compute estimated center Y for each lane (stacked from originY).
  // Each lane occupies DEFAULT_LANE_HEIGHT pixels; center is at the midpoint.
  const laneCenterYs = new Map<string, number>();
  for (let i = 0; i < sortedLanes.length; i++) {
    laneCenterYs.set(
      sortedLanes[i].id,
      originY + i * DEFAULT_LANE_HEIGHT + DEFAULT_LANE_HEIGHT / 2
    );
  }

  // Map each element to its lane's estimated center Y.
  const elementLaneYs = new Map<string, number>();
  for (const [elId, lane] of savedLaneMap) {
    const laneY = laneCenterYs.get(lane.id);
    if (laneY !== undefined) elementLaneYs.set(elId, laneY);
  }

  return elementLaneYs;
}

// ── Lane layout application ────────────────────────────────────────────────

/**
 * Apply lane-aware Y positioning and resize lanes/pool.
 *
 * After the rebuild engine positions elements (correct X, default Y),
 * this function:
 * 1. Moves each element vertically to its assigned lane's center Y
 * 2. Re-layouts all sequence flow connections (Y positions changed)
 * 3. Resizes lanes and pool to fit the content (unless skipResize is true)
 *
 * @param savedLaneMap  Pre-computed element-to-lane mapping, captured
 *                      BEFORE the rebuild (movements mutate bpmn-js
 *                      lane assignments).
 * @param skipResize    When true, skip the pool/lane resize step (task 7b).
 *                      Use when the caller will run handleAutosizePoolsAndLanes
 *                      afterwards to avoid a redundant double-resize.
 * @returns Number of elements repositioned.
 */
export function applyLaneLayout(
  registry: ElementRegistry,
  modeling: Modeling,
  participant: BpmnElement,
  originY: number,
  padding: number,
  savedLaneMap: Map<string, BpmnElement>,
  skipResize?: boolean
): number {
  const lanes = getLanesForParticipant(registry, participant);
  if (lanes.length === 0) return 0;

  // Sort lanes by original Y position (preserves lane ordering)
  const sortedLanes = [...lanes].sort((a, b) => a.y - b.y);

  // Compute lane center Y positions (stacked from originY)
  const laneCenterYs = new Map<string, number>();
  for (let i = 0; i < sortedLanes.length; i++) {
    laneCenterYs.set(sortedLanes[i].id, originY + i * DEFAULT_LANE_HEIGHT);
  }

  // Move elements to their lane's center Y.
  // Use savedLaneMap (not el.parent) so we catch elements that may
  // have been reparented when moveElements placed them outside pool bounds.
  let repositioned = 0;
  const allElements: BpmnElement[] = registry.getAll();
  const flowNodes = allElements.filter(
    (el) =>
      savedLaneMap.has(el.id) &&
      el.type !== SEQUENCE_FLOW_TYPE &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:LaneSet' &&
      el.type !== 'label'
  );

  for (const el of flowNodes) {
    const lane = savedLaneMap.get(el.id);
    if (!lane) continue;
    const targetY = laneCenterYs.get(lane.id);
    if (targetY === undefined) continue;

    const currentCenterY = el.y + el.height / 2;
    const dy = Math.round(targetY - currentCenterY);
    if (dy !== 0) {
      modeling.moveElements([el], { x: 0, y: dy });
      repositioned++;
    }
  }

  // Resize pool and lanes to fit content BEFORE re-routing connections,
  // so that connection waypoints reflect the final pool/lane geometry.
  // Skip when the caller will run handleAutosizePoolsAndLanes afterwards (task 7b).
  if (!skipResize) {
    resizePoolAndLanes(sortedLanes, participant, registry, modeling, padding, savedLaneMap);
  }

  // Re-layout connections within the pool AFTER resize (task 9a):
  // waypoints now account for the final lane widths and heights.
  // For cross-lane flows, apply a smarter vertical-drop routing (task 3b/9b)
  // that avoids routing back through unrelated lanes.
  for (const el of allElements) {
    if (el.parent === participant && el.type === SEQUENCE_FLOW_TYPE) {
      modeling.layoutConnection(el);
    }
  }

  // Post-process: improve waypoints for cross-lane sequence flows (tasks 3b, 9b).
  // After ManhattanLayout routes connections, cross-lane flows that go from one
  // lane to another may produce Z/U-paths that route through other lane regions.
  // Replace these with clean L-shaped paths (source right → target mid-Y → target).
  routeCrossLaneConnections(allElements, participant, savedLaneMap, modeling);

  return repositioned;
}

// ── Cross-lane connection routing (tasks 3b, 9b) ───────────────────────────

/**
 * Improve waypoint routing for cross-lane sequence flows.
 *
 * After `modeling.layoutConnection()` runs, flows between different lanes
 * can produce multi-bend paths that route through unrelated lane content.
 * This function replaces those with cleaner L-shaped paths:
 *
 *   source right-edge → vertical midpoint → target left-edge
 *
 * The routing prefers a single vertical segment at the X midpoint
 * between source and target, which cleanly traverses the lane boundary
 * without crossing other lanes' elements.
 *
 * Only applies to forward flows (where target.x > source.x and the
 * source and target are in different lanes).  Back-edges and same-lane
 * flows are left as-is.
 */
function routeCrossLaneConnections(
  allElements: BpmnElement[],
  participant: BpmnElement,
  savedLaneMap: Map<string, BpmnElement>,
  modeling: Modeling
): void {
  const sequenceFlows = allElements.filter(
    (el) => el.parent === participant && el.type === SEQUENCE_FLOW_TYPE && el.source && el.target
  );

  for (const flow of sequenceFlows) {
    const src = flow.source as BpmnElement;
    const tgt = flow.target as BpmnElement;

    // Only process forward flows (target is to the right of or at same X as source)
    const srcCenterX = src.x + (src.width || 0) / 2;
    const tgtCenterX = tgt.x + (tgt.width || 0) / 2;
    if (tgtCenterX <= srcCenterX) continue;

    // Only process cross-lane flows
    const srcLane = savedLaneMap.get(src.id);
    const tgtLane = savedLaneMap.get(tgt.id);
    if (!srcLane || !tgtLane || srcLane.id === tgtLane.id) continue;

    // Check current waypoints — if they already look like a clean L-shape
    // (3 waypoints, horizontal then vertical or vice versa), leave them.
    const wps = flow.waypoints;
    if (wps && wps.length <= 3) continue;

    // Compute clean L-shaped route:
    // 1. Leave source's right edge at source center Y
    // 2. Drop/rise vertically at mid-X to target center Y
    // 3. Enter target's left edge at target center Y
    const srcRightX = src.x + (src.width || 0);
    const srcCenterY = src.y + (src.height || 0) / 2;
    const tgtLeftX = tgt.x;
    const tgtCenterY = tgt.y + (tgt.height || 0) / 2;

    // Mid-X is halfway between source right edge and target left edge
    const midX = Math.round((srcRightX + tgtLeftX) / 2);

    // Only re-route if the current path is longer than 3 waypoints
    // (fewer waypoints = already clean)
    if (!wps || wps.length <= 3) continue;

    // Build a 4-waypoint L-shaped path: right → corner1 → corner2 → entry
    const cleanWaypoints = [
      { x: srcRightX, y: Math.round(srcCenterY) },
      { x: midX, y: Math.round(srcCenterY) },
      { x: midX, y: Math.round(tgtCenterY) },
      { x: tgtLeftX, y: Math.round(tgtCenterY) },
    ];

    try {
      modeling.updateWaypoints(flow, cleanWaypoints);
    } catch {
      // Non-fatal: fall back to layoutConnection's result
    }
  }
}

// ── Lane assignment restoration ────────────────────────────────────────────

/**
 * Restore `flowNodeRef` membership lists from a previously-captured
 * element-to-lane mapping.
 *
 * `modeling.moveElements` may silently update `flowNodeRef` lists when
 * elements are repositioned outside a lane's current visual bounds.
 * Calling this function after `rebuildContainer()` — but before
 * `applyLaneLayout()` — ensures the semantic lane assignments match the
 * intent captured before the rebuild.
 *
 * @param registry      Element registry for the modeler.
 * @param savedLaneMap  Map of elementId → intended lane element.
 * @param lanes         All lane elements in the participant.
 */
export function restoreLaneAssignments(
  registry: ElementRegistry,
  savedLaneMap: Map<string, BpmnElement>,
  lanes: BpmnElement[]
): void {
  if (savedLaneMap.size === 0 || lanes.length === 0) return;

  // Clear existing flowNodeRef lists for affected lanes
  const affectedLaneIds = new Set<string>([...savedLaneMap.values()].map((l) => l.id));
  for (const lane of lanes) {
    if (!affectedLaneIds.has(lane.id)) continue;
    const refs = lane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) refs.length = 0;
  }

  // Re-populate from the saved map
  for (const [elementId, lane] of savedLaneMap) {
    const el = registry.get(elementId);
    if (!el || !lane.businessObject) continue;
    const laneBo = lane.businessObject;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const elBo = el.businessObject;
    if (elBo && !laneBo.flowNodeRef.includes(elBo)) {
      laneBo.flowNodeRef.push(elBo);
    }
  }
}

// ── Pool resizing (no lanes) ───────────────────────────────────────────────

/**
 * Resize a participant pool to fit its internal elements with padding.
 * For pools without lanes.
 */
export function resizePoolToFit(
  modeling: Modeling,
  registry: ElementRegistry,
  participant: BpmnElement,
  padding: number
): void {
  const bbox = computePoolContentBBox(registry, participant);
  if (!bbox) return;

  modeling.resizeShape(participant, {
    x: bbox.minX - padding - POOL_HEADER_WIDTH,
    y: bbox.minY - padding,
    width: bbox.maxX - bbox.minX + 2 * padding + POOL_HEADER_WIDTH,
    height: bbox.maxY - bbox.minY + 2 * padding,
  });
}

// ── Pool and lane resizing ─────────────────────────────────────────────────

/**
 * Resize lanes and their parent pool to fit element content.
 *
 * Lane heights are proportional to their content extent, clamped to
 * MIN_LANE_HEIGHT.  Lanes are stacked contiguously from the pool's top
 * edge.  The pool is resized to enclose all lanes.
 *
 * This function runs AFTER applyLaneLayout() has moved elements to their
 * lane center-Y positions.  Element Y coordinates are the ground truth for
 * computing required lane extents.
 */
function resizePoolAndLanes(
  sortedLanes: BpmnElement[],
  participant: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling,
  padding: number,
  elementToLane: Map<string, BpmnElement>
): void {
  const bbox = computePoolContentBBox(registry, participant);
  if (!bbox) return;

  // Overall pool horizontal bounds from content
  const poolX = bbox.minX - padding - POOL_HEADER_WIDTH;
  const poolWidth = bbox.maxX - bbox.minX + 2 * padding + POOL_HEADER_WIDTH;
  const poolY = bbox.minY - padding;

  // Compute proportional lane heights
  const allElements: BpmnElement[] = registry.getAll();
  const skipTypes = new Set([SEQUENCE_FLOW_TYPE, 'bpmn:Lane', 'bpmn:LaneSet', 'label']);
  const flowNodes = allElements.filter((el) => !skipTypes.has(el.type) && typeof el.y === 'number');

  // For each lane, find element Y extents
  const laneExtents = sortedLanes.map((lane) => {
    const laneEls = flowNodes.filter((el) => elementToLane.get(el.id)?.id === lane.id);
    if (laneEls.length === 0) return null;
    const minY = Math.min(...laneEls.map((el) => el.y));
    const maxY = Math.max(...laneEls.map((el) => el.y + el.height));
    return { minY, maxY };
  });

  // Compute raw lane heights (content height + 2*padding, min MIN_LANE_HEIGHT)
  const rawHeights = laneExtents.map((ext) => {
    if (!ext) return MIN_LANE_HEIGHT;
    return Math.max(MIN_LANE_HEIGHT, ext.maxY - ext.minY + 2 * padding);
  });

  // Total pool height must fit all content: max of (sum of raw heights) and
  // (maxElement.bottom - minElement.top + 2*padding)
  const contentSpan = bbox.maxY - bbox.minY + 2 * padding;
  const rawTotal = rawHeights.reduce((s, h) => s + h, 0);
  const totalHeight = Math.max(rawTotal, contentSpan);

  // Scale up proportionally if needed
  const scale = totalHeight / rawTotal;
  const laneHeights = rawHeights.map((h) => Math.round(h * scale));
  // Adjust last lane to avoid rounding errors
  const heightSum = laneHeights.slice(0, -1).reduce((s, h) => s + h, 0);
  laneHeights[laneHeights.length - 1] = totalHeight - heightSum;

  modeling.resizeShape(participant, {
    x: poolX,
    y: poolY,
    width: poolWidth,
    height: totalHeight,
  });

  // Stack lanes contiguously from poolY
  const laneX = poolX + POOL_HEADER_WIDTH;
  const laneWidth = poolWidth - POOL_HEADER_WIDTH;
  let currentY = poolY;

  for (let i = 0; i < sortedLanes.length; i++) {
    modeling.resizeShape(sortedLanes[i], {
      x: laneX,
      y: currentY,
      width: laneWidth,
      height: laneHeights[i],
    });
    currentY += laneHeights[i];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute the bounding box of flow elements inside a participant. */
function computePoolContentBBox(
  registry: ElementRegistry,
  participant: BpmnElement
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const allElements: BpmnElement[] = registry.getAll();
  const children = allElements.filter(
    (el) =>
      el.parent === participant &&
      el.type !== SEQUENCE_FLOW_TYPE &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'bpmn:LaneSet' &&
      el.type !== 'label'
  );

  if (children.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }

  return { minX, minY, maxX, maxY };
}
