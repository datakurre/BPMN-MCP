/**
 * Handler for list_bpmn_elements tool.
 */

import { type ListElementsArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements } from './helpers';

export async function handleListElements(args: ListElementsArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const elements = getVisibleElements(elementRegistry);

  const elementList = elements.map((el: any) => {
    const entry: Record<string, any> = {
      id: el.id,
      type: el.type,
      name: el.businessObject?.name || '(unnamed)',
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    };

    // Add connection info
    if (el.incoming?.length) {
      entry.incoming = el.incoming.map((c: any) => c.id);
    }
    if (el.outgoing?.length) {
      entry.outgoing = el.outgoing.map((c: any) => c.id);
    }

    // For connections, show source/target
    if (el.source) entry.sourceId = el.source.id;
    if (el.target) entry.targetId = el.target.id;

    // Camunda extension attributes
    const bo = el.businessObject;
    if (bo?.$attrs) {
      const camundaAttrs: Record<string, any> = {};
      for (const [key, value] of Object.entries(bo.$attrs)) {
        if (key.startsWith('camunda:')) {
          camundaAttrs[key] = value;
        }
      }
      if (Object.keys(camundaAttrs).length > 0) {
        entry.camundaProperties = camundaAttrs;
      }
    }

    return entry;
  });

  return jsonResult({
    success: true,
    elements: elementList,
    count: elementList.length,
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_elements',
  description:
    'List all elements in a BPMN diagram with their types, names, positions, connections, and properties.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
