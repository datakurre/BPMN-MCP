/**
 * Handler for create_bpmn_collaboration tool.
 *
 * Higher-level helper for creating collaboration diagrams with multiple
 * participants (pools) and optional message flows between them.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  validateArgs,
} from './helpers';
import { appendLintFeedback } from '../linter';
import { ELEMENT_SIZES } from '../constants';

export interface CreateCollaborationArgs {
  diagramId: string;
  participants: Array<{
    name: string;
    processId?: string;
  }>;
}

export async function handleCreateCollaboration(
  args: CreateCollaborationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'participants']);
  const { diagramId, participants } = args;

  if (!participants || participants.length < 2) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least 2 participants are required to create a collaboration diagram'
    );
  }

  const diagram = requireDiagram(diagramId);
  const modeling = diagram.modeler.get('modeling');
  const elementFactory = diagram.modeler.get('elementFactory');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const canvas = diagram.modeler.get('canvas');

  const createdIds: string[] = [];
  const poolHeight = ELEMENT_SIZES.participant.height;
  const verticalGap = 30;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const id = generateDescriptiveId(elementRegistry, 'bpmn:Participant', p.name);
    const y = 100 + i * (poolHeight + verticalGap);

    const shape = elementFactory.createShape({
      type: 'bpmn:Participant',
      id,
    });

    const rootElement = canvas.getRootElement();
    const createdElement = modeling.createShape(shape, { x: 300, y }, rootElement);
    modeling.updateProperties(createdElement, { name: p.name });

    if (p.processId) {
      const bo = createdElement.businessObject;
      if (bo.processRef) {
        bo.processRef.id = p.processId;
      }
    }

    createdIds.push(createdElement.id);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    participantIds: createdIds,
    participantCount: createdIds.length,
    message: `Created collaboration with ${createdIds.length} participants: ${createdIds.join(', ')}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_collaboration',
  description:
    'Create a collaboration diagram with multiple participants (pools). Requires at least 2 participants. Each participant gets its own process. Use connect_bpmn_elements with connectionType "bpmn:MessageFlow" to add message flows between pools.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Participant/pool name' },
            processId: {
              type: 'string',
              description: 'Optional custom process ID for the participant',
            },
          },
          required: ['name'],
        },
        description: 'Array of participants to create (minimum 2)',
        minItems: 2,
      },
    },
    required: ['diagramId', 'participants'],
  },
} as const;
