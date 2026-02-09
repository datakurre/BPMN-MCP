/**
 * Handler for search_bpmn_elements tool.
 *
 * Provides filtering capabilities on diagram elements by name pattern,
 * element type, or property value.  Reduces the need to parse full
 * list_bpmn_elements output for large diagrams.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from './helpers';

export interface SearchElementsArgs {
  diagramId: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
}

export async function handleSearchElements(args: SearchElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, namePattern, elementType, property } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  let elements = getVisibleElements(elementRegistry);

  // Filter by element type
  if (elementType) {
    elements = elements.filter((el: any) => el.type === elementType);
  }

  // Filter by name pattern (case-insensitive regex)
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    elements = elements.filter((el: any) => {
      const name = el.businessObject?.name || '';
      return regex.test(name);
    });
  }

  // Filter by property key/value
  if (property) {
    elements = elements.filter((el: any) => {
      const bo = el.businessObject;
      if (!bo) return false;

      // Check standard properties
      const key = property.key;
      let val: any;

      if (key.startsWith('camunda:')) {
        val = bo.$attrs?.[key] ?? bo[key];
      } else {
        val = bo[key];
      }

      if (val === undefined) return false;
      if (property.value === undefined) return true; // key-exists check
      return String(val) === property.value;
    });
  }

  const results = elements.map((el: any) => {
    const entry: Record<string, any> = {
      id: el.id,
      type: el.type,
      name: el.businessObject?.name || '(unnamed)',
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    };

    if (el.incoming?.length) {
      entry.incoming = el.incoming.map((c: any) => c.id);
    }
    if (el.outgoing?.length) {
      entry.outgoing = el.outgoing.map((c: any) => c.id);
    }
    if (el.source) entry.sourceId = el.source.id;
    if (el.target) entry.targetId = el.target.id;

    return entry;
  });

  return jsonResult({
    success: true,
    elements: results,
    count: results.length,
    filters: {
      ...(namePattern ? { namePattern } : {}),
      ...(elementType ? { elementType } : {}),
      ...(property ? { property } : {}),
    },
  });
}

export const TOOL_DEFINITION = {
  name: 'search_bpmn_elements',
  description:
    'Search for elements in a BPMN diagram by name pattern, element type, or property value. Returns matching elements with their IDs, types, names, and positions. More efficient than list_bpmn_elements for large diagrams when you know what you are looking for.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      namePattern: {
        type: 'string',
        description: 'Regular expression pattern to match against element names (case-insensitive)',
      },
      elementType: {
        type: 'string',
        description:
          "BPMN element type to filter by (e.g. 'bpmn:UserTask', 'bpmn:ExclusiveGateway')",
      },
      property: {
        type: 'object',
        description: 'Filter by a specific property key and optional value',
        properties: {
          key: {
            type: 'string',
            description: "Property key to check (e.g. 'camunda:assignee', 'isExecutable')",
          },
          value: {
            type: 'string',
            description: 'Expected property value (omit to check key existence only)',
          },
        },
        required: ['key'],
      },
    },
    required: ['diagramId'],
  },
} as const;
