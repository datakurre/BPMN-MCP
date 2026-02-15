/**
 * Handler for delete_diagram tool.
 */
// @mutating

import { type ToolResult } from '../../types';
import { deleteDiagram as deleteDiagramFromStore } from '../../diagram-manager';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { jsonResult } from '../helpers';

export interface DeleteDiagramArgs {
  diagramId: string;
}

export async function handleDeleteDiagram(args: DeleteDiagramArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const deleted = deleteDiagramFromStore(diagramId);
  if (!deleted) {
    throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
  }
  return jsonResult({
    success: true,
    diagramId,
    message: `Deleted diagram ${diagramId}`,
  });
}

export const TOOL_DEFINITION = {
  name: 'delete_bpmn_diagram',
  description: 'Remove a diagram from the in-memory store.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The ID of the diagram to delete',
      },
    },
    required: ['diagramId'],
  },
} as const;
