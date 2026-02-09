/**
 * Handler for move_bpmn_element tool.
 */

import { type MoveElementArgs, type ToolResult } from '../types';
import { requireDiagram, requireElement, jsonResult, syncXml } from './helpers';

export async function handleMoveElement(args: MoveElementArgs): Promise<ToolResult> {
  const { diagramId, elementId, x, y } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');

  const element = requireElement(elementRegistry, elementId);
  const deltaX = x - element.x;
  const deltaY = y - element.y;
  modeling.moveElements([element], { x: deltaX, y: deltaY });

  await syncXml(diagram);

  return jsonResult({
    success: true,
    elementId,
    position: { x, y },
    message: `Moved element ${elementId} to (${x}, ${y})`,
  });
}

export const TOOL_DEFINITION = {
  name: 'move_bpmn_element',
  description:
    'Move an element to a new position in the diagram. Coordinates are canvas-global (absolute), not relative to the parent container. For elements inside participants or subprocesses, the element will be moved to the specified global coordinates. Note: moving an element outside its parent container bounds may produce invalid BPMN.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to move',
      },
      x: {
        type: 'number',
        description:
          'New X coordinate (canvas-global absolute position, not relative to parent container)',
      },
      y: {
        type: 'number',
        description:
          'New Y coordinate (canvas-global absolute position, not relative to parent container)',
      },
    },
    required: ['diagramId', 'elementId', 'x', 'y'],
  },
} as const;
