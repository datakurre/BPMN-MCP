/**
 * Handler for redo_bpmn_change tool.
 *
 * Uses bpmn-js commandStack to redo the last undone change on a diagram.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, syncXml, validateArgs } from './helpers';

export interface RedoChangeArgs {
  diagramId: string;
}

export async function handleRedoChange(args: RedoChangeArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const commandStack = diagram.modeler.get('commandStack');
  if (!commandStack.canRedo()) {
    return jsonResult({
      success: false,
      message: 'Nothing to redo — no undone changes available',
    });
  }

  commandStack.redo();
  await syncXml(diagram);

  return jsonResult({
    success: true,
    canUndo: commandStack.canUndo(),
    canRedo: commandStack.canRedo(),
    message: 'Redid last undone change',
  });
}

export const TOOL_DEFINITION = {
  name: 'redo_bpmn_change',
  description:
    'Redo the last undone change on a BPMN diagram. Uses the bpmn-js command stack to re-apply the most recently undone operation.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
