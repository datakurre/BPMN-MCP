/**
 * Handler for summarize_bpmn_diagram tool.
 *
 * Returns a lightweight summary of a diagram: process name, element
 * counts by type, participant/lane names, and connectivity stats.
 * Useful for AI callers to orient before making changes.
 */
// @readonly

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  jsonResult,
  getVisibleElements,
  validateArgs,
  isInfrastructureElement,
  isConnectionElement,
  getService,
  getProcesses,
} from '../helpers';

export interface SummarizeDiagramArgs {
  diagramId: string;
}

/**
 * Build a structure recommendation based on the current diagram state.
 * Suggests pools vs lanes based on participants, lanes, and element patterns.
 */
function buildStructureRecommendation(
  participants: any[],
  lanes: any[],
  flowElements: any[]
): string | null {
  const expandedPools = participants.filter(
    (p: any) => p.di?.isExpanded !== false && p.children && p.children.length > 0
  );

  // Multiple expanded pools → suggest checking if lanes would be more appropriate
  if (expandedPools.length > 1) {
    return (
      'This diagram uses multiple expanded pools (collaboration). ' +
      'If the pools represent roles within the same organization, consider ' +
      'using a single pool with lanes instead. Use convert_collaboration_to_lanes or ' +
      'create a new diagram with create_bpmn_lanes for role separation.'
    );
  }

  // Single pool with no lanes but many distinct user task assignees
  if (participants.length <= 1 && lanes.length === 0) {
    const userTasks = flowElements.filter(
      (el: any) => el.type === 'bpmn:UserTask' || el.type === 'bpmn:ManualTask'
    );
    if (userTasks.length >= 3) {
      const assignees = new Set<string>();
      for (const t of userTasks) {
        const a = t.businessObject?.$attrs?.['camunda:assignee'] ?? t.businessObject?.assignee;
        if (a) assignees.add(String(a));
      }
      if (assignees.size >= 2) {
        return (
          `Found ${assignees.size} distinct assignees (${[...assignees].join(', ')}) across ` +
          `${userTasks.length} user tasks without lanes. Consider using analyze_bpmn_lanes (mode: suggest) ` +
          'and create_bpmn_lanes to organize tasks by role.'
        );
      }
      if (assignees.size === 0) {
        return (
          `Found ${userTasks.length} user/manual tasks without lanes. ` +
          'Consider adding camunda:assignee to tasks and organizing into lanes, ' +
          'or use analyze_bpmn_lanes (mode: suggest) for a type-based lane suggestion.'
        );
      }
    }
  }

  // Pool with lanes — all good
  if (lanes.length > 0) {
    return null; // No recommendation needed
  }

  return null;
}

/** Classify a flow element as disconnected (missing expected connections). */
function isDisconnected(el: any): boolean {
  const hasIncoming = el.incoming && el.incoming.length > 0;
  const hasOutgoing = el.outgoing && el.outgoing.length > 0;
  if (el.type === 'bpmn:StartEvent') return !hasOutgoing;
  if (el.type === 'bpmn:EndEvent') return !hasIncoming;
  if (
    el.type === 'bpmn:TextAnnotation' ||
    el.type === 'bpmn:DataObjectReference' ||
    el.type === 'bpmn:DataStoreReference' ||
    el.type === 'bpmn:Group'
  ) {
    return false;
  }
  return !hasIncoming && !hasOutgoing;
}

export async function handleSummarizeDiagram(args: SummarizeDiagramArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Element counts by type
  const typeCounts: Record<string, number> = {};
  for (const el of allElements) {
    const t = el.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Process name
  const processes = getProcesses(elementRegistry);
  const processNames = processes.map((p) => p.businessObject?.name || p.id).filter(Boolean);

  // Participants (pools)
  const participants = allElements.filter((el) => el.type === 'bpmn:Participant');
  const participantInfo = participants.map((p) => ({
    id: p.id,
    name: p.businessObject?.name || '(unnamed)',
  }));

  // Lanes
  const lanes = allElements.filter((el) => el.type === 'bpmn:Lane');
  const laneInfo = lanes.map((l) => ({
    id: l.id,
    name: l.businessObject?.name || '(unnamed)',
  }));

  // Connections
  const flows = allElements.filter((el) => isConnectionElement(el.type));

  // Flow elements (tasks, events, gateways — excluding connections, pools, lanes)
  const flowElements = allElements.filter((el) => !isInfrastructureElement(el.type));

  // Disconnected elements (no incoming or outgoing)
  const disconnected = flowElements.filter(isDisconnected);

  // Named elements
  const namedElements = flowElements
    .filter((el) => el.businessObject?.name)
    .map((el) => ({
      id: el.id,
      type: el.type,
      name: el.businessObject.name,
    }));

  // Structure recommendation: suggest pools vs lanes based on current state
  const structureRecommendation = buildStructureRecommendation(participants, lanes, flowElements);

  return jsonResult({
    success: true,
    diagramName: diagram.name || processNames[0] || '(unnamed)',
    draftMode: diagram.draftMode ?? false,
    processNames,
    participants: participantInfo.length > 0 ? participantInfo : undefined,
    lanes: laneInfo.length > 0 ? laneInfo : undefined,
    elementCounts: typeCounts,
    totalElements: allElements.length,
    flowElementCount: flowElements.length,
    connectionCount: flows.length,
    disconnectedCount: disconnected.length,
    namedElements,
    ...(disconnected.length > 0
      ? {
          disconnectedElements: disconnected.map((el) => ({
            id: el.id,
            type: el.type,
            name: el.businessObject?.name || '(unnamed)',
          })),
        }
      : {}),
    ...(structureRecommendation ? { structureRecommendation } : {}),
  });
}

export const TOOL_DEFINITION = {
  name: 'summarize_bpmn_diagram',
  description:
    'Get a lightweight summary of a BPMN diagram: process name, element counts by type, ' +
    'participant/lane names, named elements, and connectivity stats. Useful for orienting ' +
    'before making changes — avoids the overhead of listing every element with full details.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
