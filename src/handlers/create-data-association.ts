/**
 * Handler for create_bpmn_data_association tool.
 *
 * Creates data associations between activities and data object references
 * or data store references.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export interface CreateDataAssociationArgs {
  diagramId: string;
  sourceElementId: string;
  targetElementId: string;
}

export async function handleCreateDataAssociation(
  args: CreateDataAssociationArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'sourceElementId', 'targetElementId']);
  const { diagramId, sourceElementId, targetElementId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const source = requireElement(elementRegistry, sourceElementId);
  const target = requireElement(elementRegistry, targetElementId);

  const sourceType = source.type || '';
  const targetType = target.type || '';

  // Determine association direction
  const isSourceData = sourceType.includes('DataObject') || sourceType.includes('DataStore');
  const isTargetData = targetType.includes('DataObject') || targetType.includes('DataStore');

  if (!isSourceData && !isTargetData) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'At least one of source or target must be a DataObjectReference or DataStoreReference'
    );
  }

  // Create the connection using bpmn:DataInputAssociation or bpmn:DataOutputAssociation
  // In BPMN, data flows FROM data object TO task = DataInputAssociation
  // and FROM task TO data object = DataOutputAssociation
  // bpmn-js handles this via the modeling API's connect method with the right type
  const connectionType = isSourceData ? 'bpmn:DataInputAssociation' : 'bpmn:DataOutputAssociation';

  // Use bpmn:Association as the visual connection type — bpmn-js will
  // create the appropriate data association semantics
  const connection = modeling.connect(source, target, {
    type: 'bpmn:Association',
  });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionId: connection.id,
    connectionType,
    sourceElementId,
    targetElementId,
    message: `Created data association from ${sourceElementId} to ${targetElementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_data_association',
  description:
    'Create a data association between an activity and a data object reference or data store reference. Automatically determines the direction (input or output) based on element types.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      sourceElementId: {
        type: 'string',
        description: 'The ID of the source element (activity or data object/store)',
      },
      targetElementId: {
        type: 'string',
        description: 'The ID of the target element (activity or data object/store)',
      },
    },
    required: ['diagramId', 'sourceElementId', 'targetElementId'],
  },
} as const;
