/**
 * Collision-avoidance helpers for add-element placement.
 *
 * Extracted from add-element-helpers.ts to stay within the 350-line limit.
 */

import { getVisibleElements } from '../helpers';
import { STANDARD_BPMN_GAP } from '../../constants';

/** BPMN element type strings excluded from collision checks. */
const EXCLUDED_TYPES = ['SequenceFlow', 'MessageFlow', 'Association'];
const EXCLUDED_EXACT = ['bpmn:Participant', 'bpmn:Lane', 'bpmn:Process'];

/** Returns false if the element type should be included in collision checks. */
function isCollisionCandidate(el: any, excludeId?: string, excludeIds?: Set<string>): boolean {
  if (excludeId && el.id === excludeId) return false;
  if (excludeIds && excludeIds.has(el.id)) return false;
  if (EXCLUDED_EXACT.includes(el.type)) return false;
  for (const t of EXCLUDED_TYPES) {
    if (el.type?.includes(t)) return false;
  }
  return true;
}

/** Test whether two bounding boxes (center-based for the new element) overlap. */
function boxesOverlap(cx: number, cy: number, halfW: number, halfH: number, el: any): boolean {
  const elLeft = el.x ?? 0;
  const elTop = el.y ?? 0;
  const elRight = elLeft + (el.width ?? 0);
  const elBottom = elTop + (el.height ?? 0);
  const newLeft = cx - halfW;
  const newTop = cy - halfH;
  const newRight = cx + halfW;
  const newBottom = cy + halfH;
  return newLeft < elRight && newRight > elLeft && newTop < elBottom && newBottom > elTop;
}

/**
 * Collision-avoidance: shift position RIGHT so the new element doesn't overlap
 * or stack on top of an existing one.  Scans up to 20 iterations to find
 * an open slot by shifting right by `STANDARD_BPMN_GAP`.
 *
 * @param excludeIds - Element IDs to exclude from collision checks (e.g. parent containers).
 */
export function avoidCollision(
  elementRegistry: any,
  x: number,
  y: number,
  elementWidth: number,
  elementHeight: number,
  excludeIds?: Set<string>
): { x: number; y: number } {
  const candidates = getVisibleElements(elementRegistry).filter((el: any) =>
    isCollisionCandidate(el, undefined, excludeIds)
  );

  let cx = x;
  const halfW = elementWidth / 2;
  const halfH = elementHeight / 2;

  for (let attempt = 0; attempt < 20; attempt++) {
    if (!candidates.some((el: any) => boxesOverlap(cx, y, halfW, halfH, el))) break;
    cx += elementWidth + STANDARD_BPMN_GAP;
  }

  return { x: cx, y };
}

/**
 * Collision-avoidance for `afterElementId` placement: shift position DOWNWARD
 * so the new element doesn't overlap an existing element on a parallel branch.
 * Scans up to 20 iterations to find an open slot by shifting down.
 *
 * Used by C2-1 when adding an element after another element that may have
 * siblings placed at the same X coordinate.
 *
 * @param excludeId  - The afterElementId to exclude from checks (the anchor element).
 * @param excludeIds - Additional element IDs to exclude (e.g. parent containers).
 */
export function avoidCollisionY(
  elementRegistry: any,
  x: number,
  y: number,
  elementWidth: number,
  elementHeight: number,
  excludeId?: string,
  excludeIds?: Set<string>
): { x: number; y: number } {
  const candidates = getVisibleElements(elementRegistry).filter((el: any) =>
    isCollisionCandidate(el, excludeId, excludeIds)
  );

  let cy = y;
  const halfW = elementWidth / 2;
  const halfH = elementHeight / 2;

  for (let attempt = 0; attempt < 20; attempt++) {
    if (!candidates.some((el: any) => boxesOverlap(x, cy, halfW, halfH, el))) break;
    cy += elementHeight + STANDARD_BPMN_GAP;
  }

  return { x, y: cy };
}
