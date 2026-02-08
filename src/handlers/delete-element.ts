/**
 * Handler for delete_bpmn_element tool.
 */

import { type DeleteElementArgs, type ToolResult } from '../types';
import { requireDiagram, requireElement, jsonResult, syncXml } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleDeleteElement(args: DeleteElementArgs): Promise<ToolResult> {
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);
  modeling.removeElements([element]);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    message: `Removed element ${elementId} from diagram`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'delete_bpmn_element',
  description: 'Remove an element or connection from a BPMN diagram.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element or connection to remove',
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
