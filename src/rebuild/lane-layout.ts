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
 */
const DEFAULT_LANE_HEIGHT = 250;

/**
 * Minimum lane height (px) even for empty / sparse lanes.
 */
const MIN_LANE_HEIGHT = 120;

/**
 * Width (px) of the pool's left header strip.
 * Lanes start after this strip.
 */
const POOL_HEADER_WIDTH = 30;

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

// ── Lane layout application ────────────────────────────────────────────────

/**
 * Apply lane-aware Y positioning and resize lanes/pool.
 *
 * After the rebuild engine positions elements (correct X, default Y),
 * this function:
 * 1. Moves each element vertically to its assigned lane's center Y
 * 2. Re-layouts all sequence flow connections (Y positions changed)
 * 3. Resizes lanes and pool to fit the content
 *
 * @param savedLaneMap  Pre-computed element-to-lane mapping, captured
 *                      BEFORE the rebuild (movements mutate bpmn-js
 *                      lane assignments).
 * @returns Number of elements repositioned.
 */
export function applyLaneLayout(
  registry: ElementRegistry,
  modeling: Modeling,
  participant: BpmnElement,
  originY: number,
  padding: number,
  savedLaneMap: Map<string, BpmnElement>
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
      el.type !== 'bpmn:SequenceFlow' &&
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

  // Re-layout connections within the pool (Y positions changed)
  for (const el of allElements) {
    if (el.parent === participant && el.type === 'bpmn:SequenceFlow') {
      modeling.layoutConnection(el);
    }
  }

  // Resize pool and lanes to fit content (proportional lane heights)
  resizePoolAndLanes(sortedLanes, participant, registry, modeling, padding, savedLaneMap);

  return repositioned;
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
  const skipTypes = new Set(['bpmn:SequenceFlow', 'bpmn:Lane', 'bpmn:LaneSet', 'label']);
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
      el.type !== 'bpmn:SequenceFlow' &&
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
