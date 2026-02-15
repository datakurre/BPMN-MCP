/**
 * Shared lane manipulation helpers.
 *
 * Extracted from multiple collaboration handlers that duplicated these
 * patterns (auto-distribute, assign-elements-to-lane, etc.).
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

/**
 * Remove an element's business object from all lanes' flowNodeRef lists.
 *
 * This ensures an element is not double-registered when moving between lanes.
 */
export function removeFromAllLanes(elementRegistry: ElementRegistry, elementBo: any): void {
  const allLanes = (elementRegistry as any).filter((el: BpmnElement) => el.type === 'bpmn:Lane');
  for (const lane of allLanes) {
    const refs = lane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) {
      const idx = refs.indexOf(elementBo);
      if (idx >= 0) refs.splice(idx, 1);
    }
  }
}

/**
 * Add an element's business object to a lane's flowNodeRef list.
 *
 * Idempotent: does nothing if the element is already in the lane.
 */
export function addToLane(lane: BpmnElement, elementBo: any): void {
  const laneBo = lane.businessObject;
  if (!laneBo) return;
  const refs: any[] = (laneBo.flowNodeRef as any[] | undefined) || [];
  if (!laneBo.flowNodeRef) laneBo.flowNodeRef = refs;
  if (!refs.includes(elementBo)) refs.push(elementBo);
}

/**
 * Get all elements assigned to a specific lane (via flowNodeRef).
 */
export function getLaneElements(lane: BpmnElement): any[] {
  const refs = lane.businessObject?.flowNodeRef;
  return Array.isArray(refs) ? refs : [];
}

/**
 * Get sibling lanes of a given lane (other lanes in the same participant).
 */
export function getSiblingLanes(
  elementRegistry: ElementRegistry,
  lane: BpmnElement
): BpmnElement[] {
  const parentId = lane.parent?.id;
  if (!parentId) return [];
  return (elementRegistry as any).filter(
    (el: BpmnElement) => el.type === 'bpmn:Lane' && el.parent?.id === parentId && el.id !== lane.id
  );
}
