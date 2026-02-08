/**
 * Centralised magic numbers and element-size constants.
 *
 * Keeps layout-related values in one place so changes propagate
 * consistently across all handlers that do positioning / spacing.
 */

/** Standard edge-to-edge gap in pixels between BPMN elements. */
export const STANDARD_BPMN_GAP = 50;

/**
 * Default element sizes used for layout calculations.
 *
 * These mirror the bpmn-js defaults for each element category.
 */
export const ELEMENT_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  task:       { width: 100, height: 80 },
  event:      { width: 36,  height: 36 },
  gateway:    { width: 50,  height: 50 },
  subprocess: { width: 350, height: 200 },
  participant:{ width: 600, height: 250 },
  default:    { width: 100, height: 80 },
};

/** Look up the default size for a given BPMN element type string. */
export function getElementSize(elementType: string): { width: number; height: number } {
  if (elementType.includes("Gateway"))    return ELEMENT_SIZES.gateway;
  if (elementType.includes("Event"))      return ELEMENT_SIZES.event;
  if (elementType === "bpmn:SubProcess")  return ELEMENT_SIZES.subprocess;
  if (elementType === "bpmn:Participant") return ELEMENT_SIZES.participant;
  if (elementType.includes("Task") || elementType === "bpmn:CallActivity") {
    return ELEMENT_SIZES.task;
  }
  return ELEMENT_SIZES.default;
}
