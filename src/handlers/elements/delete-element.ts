/**
 * Handler for delete_bpmn_element tool.
 *
 * Supports both single element deletion (elementId) and bulk deletion
 * (elementIds array) to avoid repeated round-trips.
 */
// @mutating

import { type ToolResult } from '../../types';
import type { BpmnElement } from '../../bpmn-types';
import { elementNotFoundError, missingRequiredError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  buildElementCounts,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { getSiblingLanes, getLaneElements, addToLane } from '../lane-helpers';

export interface DeleteElementArgs {
  diagramId: string;
  elementId?: string;
  /** Array of element/connection IDs to remove in a single call (bulk mode). */
  elementIds?: string[];
}

export async function handleDeleteElement(args: DeleteElementArgs): Promise<ToolResult> {
  const { diagramId, elementId } = args;
  const { elementIds } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // Bulk deletion mode
  if (elementIds && Array.isArray(elementIds) && elementIds.length > 0) {
    return handleBulkDelete(diagram, elementIds, modeling, elementRegistry);
  }

  // Single element deletion (backward compatible)
  if (!elementId) throw missingRequiredError(['elementId']);

  const element = requireElement(elementRegistry, elementId);
  const cleanup = performLaneCleanup([element], elementRegistry, diagram.modeler);
  cleanup.preDelete();
  modeling.removeElements([element]);
  const laneNotes = cleanup.postDelete();
  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    ...(laneNotes.length > 0 ? { laneCleanup: laneNotes } : {}),
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Removed element ${elementId} from diagram`,
    nextSteps: DELETE_NEXT_STEPS,
  });
  return appendLintFeedback(result, diagram);
}

/** Handle bulk deletion of multiple elements. */
async function handleBulkDelete(
  diagram: any,
  elementIds: string[],
  modeling: any,
  elementRegistry: any
): Promise<ToolResult> {
  const elements: BpmnElement[] = [];
  const notFound: string[] = [];
  for (const id of elementIds) {
    const el = elementRegistry.get(id);
    if (el) elements.push(el);
    else notFound.push(id);
  }

  if (elements.length === 0) throw elementNotFoundError(elementIds.join(', '));

  const cleanup = performLaneCleanup(elements, elementRegistry, diagram.modeler);
  cleanup.preDelete();
  modeling.removeElements(elements);
  const laneNotes = cleanup.postDelete();
  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    deletedCount: elements.length,
    deletedIds: elements.map((el: any) => el.id),
    ...(notFound.length > 0
      ? { notFound, warning: `${notFound.length} element(s) not found` }
      : {}),
    ...(laneNotes.length > 0 ? { laneCleanup: laneNotes } : {}),
    diagramCounts: buildElementCounts(elementRegistry),
    message: `Removed ${elements.length} element(s) from diagram`,
    nextSteps: DELETE_NEXT_STEPS,
  });
  return appendLintFeedback(result, diagram);
}

// ── Lane cleanup helpers ───────────────────────────────────────────────────

/**
 * Pre-delete lane cleanup: reassign orphaned elements to sibling lanes.
 * Post-delete cleanup: remove empty LaneSet containers.
 * Returns informational notes about cleanup actions taken.
 */
function performLaneCleanup(
  elements: BpmnElement[],
  elementRegistry: any,
  modeler: any
): { preDelete: () => void; postDelete: () => string[] } {
  // Collect lanes being deleted and their orphans
  const laneElements = elements.filter((el) => el.type === 'bpmn:Lane');

  return {
    preDelete() {
      for (const lane of laneElements) {
        reassignOrphanedLaneElements(elementRegistry, lane);
      }
    },
    postDelete() {
      const notes: string[] = [];
      for (const lane of laneElements) {
        notes.push(...describeReassignment(elementRegistry, lane));
      }
      notes.push(...cleanupEmptyLaneSets(modeler));
      return notes;
    },
  };
}

/** Describe what happened to orphaned lane elements (for response messages). */
function describeReassignment(elementRegistry: any, lane: BpmnElement): string[] {
  const orphans = getLaneElements(lane);
  if (orphans.length === 0) return [];
  const siblings = getSiblingLanes(elementRegistry, lane);
  if (siblings.length === 0) {
    return [`Last lane deleted: ${orphans.length} element(s) are now unassigned in the pool`];
  }
  const targetName = siblings[0].businessObject?.name || siblings[0].id;
  return [`Reassigned ${orphans.length} element(s) from deleted lane to "${targetName}"`];
}

/**
 * When a lane is being deleted, reassign its orphaned elements to a
 * sibling lane (the first remaining lane in the same participant).
 */
function reassignOrphanedLaneElements(elementRegistry: any, lane: BpmnElement): void {
  const orphans = getLaneElements(lane);
  if (orphans.length === 0) return;
  const siblings = getSiblingLanes(elementRegistry, lane);
  if (siblings.length === 0) return;
  for (const elemBo of orphans) {
    addToLane(siblings[0], elemBo);
  }
}

/** After lane deletion, clean up empty LaneSet containers. */
function cleanupEmptyLaneSets(modeler: any): string[] {
  const notes: string[] = [];
  try {
    const reg = modeler.get('elementRegistry');
    if (reg.filter((el: any) => el.type === 'bpmn:Lane').length > 0) return notes;

    const processes = reg.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Participant'
    );
    for (const proc of processes) {
      const bo = proc.businessObject?.processRef || proc.businessObject;
      if (!bo?.laneSets || !Array.isArray(bo.laneSets)) continue;
      bo.laneSets = bo.laneSets.filter((ls: any) => ls.lanes?.length > 0);
      if (bo.laneSets.length === 0) {
        delete bo.laneSets;
        notes.push('Cleaned up empty LaneSet container');
      }
    }
  } catch {
    // Cleanup is best-effort; don't block deletion
  }
  return notes;
}

// ── Shared result builder ──────────────────────────────────────────────────

const DELETE_NEXT_STEPS = [
  {
    tool: 'validate_bpmn_diagram',
    description: 'Validate the diagram to check for disconnected elements or missing connections.',
  },
  {
    tool: 'layout_bpmn_diagram',
    description: 'Re-layout the diagram if the deletion created gaps.',
  },
];

export const TOOL_DEFINITION = {
  name: 'delete_bpmn_element',
  description:
    'Remove one or more elements or connections from a BPMN diagram. ' +
    'Supports single deletion via elementId or bulk deletion via elementIds array.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element or connection to remove (single mode)',
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of element/connection IDs to remove in a single call (bulk mode). ' +
          'When provided, elementId is ignored.',
      },
    },
    required: ['diagramId'],
  },
} as const;
