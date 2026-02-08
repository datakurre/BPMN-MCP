/**
 * Handler for undo_bpmn_change tool.
 *
 * Uses bpmn-js commandStack to undo the last change on a diagram.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, syncXml, validateArgs } from './helpers';

export interface UndoChangeArgs {
  diagramId: string;
}

export async function handleUndoChange(args: UndoChangeArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const commandStack = diagram.modeler.get('commandStack');
  if (!commandStack.canUndo()) {
    return jsonResult({
      success: false,
      message: 'Nothing to undo — command stack is empty',
    });
  }

  commandStack.undo();
  await syncXml(diagram);

  return jsonResult({
    success: true,
    canUndo: commandStack.canUndo(),
    canRedo: commandStack.canRedo(),
    message: 'Undid last change',
  });
}

export const TOOL_DEFINITION = {
  name: 'undo_bpmn_change',
  description:
    'Undo the last change on a BPMN diagram. Uses the bpmn-js command stack to reverse the most recent operation.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
