/**
 * Backward-compatibility shim for distribute_bpmn_elements.
 *
 * Distribution is now handled by the merged align_bpmn_elements tool.
 * This module re-exports the handler so existing imports keep working.
 */

export { handleDistributeElements } from './align-elements';
