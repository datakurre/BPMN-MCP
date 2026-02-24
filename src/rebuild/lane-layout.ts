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

  // Move elements to their lane's center Y
  let repositioned = 0;
  const allElements: BpmnElement[] = registry.getAll();
  const flowNodes = allElements.filter(
    (el) =>
      el.parent === participant &&
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

  // Resize pool and lanes to fit content
  resizePoolAndLanes(sortedLanes, participant, registry, modeling, padding);

  return repositioned;
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
 * Lanes are divided equally within the pool height.
 */
function resizePoolAndLanes(
  sortedLanes: BpmnElement[],
  participant: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling,
  padding: number
): void {
  const bbox = computePoolContentBBox(registry, participant);
  if (!bbox) return;

  // Pool bounds
  const poolBounds = {
    x: bbox.minX - padding - POOL_HEADER_WIDTH,
    y: bbox.minY - padding,
    width: bbox.maxX - bbox.minX + 2 * padding + POOL_HEADER_WIDTH,
    height: bbox.maxY - bbox.minY + 2 * padding,
  };

  modeling.resizeShape(participant, poolBounds);

  // Resize each lane: divide pool height equally
  const laneX = poolBounds.x + POOL_HEADER_WIDTH;
  const laneWidth = poolBounds.width - POOL_HEADER_WIDTH;
  const laneHeight = poolBounds.height / sortedLanes.length;

  for (let i = 0; i < sortedLanes.length; i++) {
    modeling.resizeShape(sortedLanes[i], {
      x: laneX,
      y: poolBounds.y + i * laneHeight,
      width: laneWidth,
      height: laneHeight,
    });
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
