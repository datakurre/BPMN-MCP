/**
 * Pre-layout helper to expand collapsed subprocesses that contain internal flow.
 *
 * When importing BPMN XML without DI (diagram interchange), `bpmn-auto-layout`
 * generates collapsed subprocess DI (separate BPMNPlane per subprocess) rather
 * than expanded inline DI.  This helper detects such subprocesses and uses
 * `bpmnReplace` to convert them to expanded mode so ELK can lay out their
 * children inline on the main plane.
 */

import { getService } from '../helpers';

/**
 * Check whether a SubProcess element is a candidate for expansion:
 * - DI shape has `isExpanded !== true` (collapsed)
 * - Business object has child `flowElements`
 * - NOT a `triggeredByEvent` event subprocess
 */
function isExpansionCandidate(el: any): boolean {
  if (el.type !== 'bpmn:SubProcess') return false;
  if (el.di?.isExpanded === true) return false;

  const bo = el.businessObject;
  if (bo?.triggeredByEvent) return false;

  const flowElements = bo?.flowElements;
  return flowElements != null && flowElements.length > 0;
}

/** Attempt to expand a single collapsed subprocess via bpmnReplace.  Returns true on success. */
function expandOne(el: any, bpmnReplace: any): boolean {
  try {
    const result = bpmnReplace.replaceElement(el, {
      type: 'bpmn:SubProcess',
      isExpanded: true,
    });
    return result != null;
  } catch {
    // Fallback: directly set on DI if bpmnReplace fails
    if (el.di) {
      el.di.isExpanded = true;
      return true;
    }
    return false;
  }
}

/**
 * Find and expand collapsed subprocesses that have internal flow-node children.
 *
 * Uses `bpmnReplace.replaceElement` to properly toggle expansion state,
 * which moves children from the drill-down plane to the main plane and
 * adjusts the shape size.
 *
 * @returns Number of subprocesses that were expanded.
 */
export function expandCollapsedSubprocesses(diagram: any): number {
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  let bpmnReplace: any;
  try {
    bpmnReplace = getService(diagram.modeler, 'bpmnReplace');
  } catch {
    return 0;
  }

  const candidates = elementRegistry.getAll().filter(isExpansionCandidate);
  if (candidates.length === 0) return 0;

  let count = 0;
  for (const el of candidates) {
    if (expandOne(el, bpmnReplace)) count++;
  }
  return count;
}
