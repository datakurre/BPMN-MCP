/**
 * Handler for list_diagrams tool.
 */

import { type ToolResult } from '../types';
import { getAllDiagrams } from '../diagram-manager';
import { jsonResult, getVisibleElements } from './helpers';

export async function handleListDiagrams(): Promise<ToolResult> {
  const diagrams = getAllDiagrams();
  const list: any[] = [];

  for (const [id, state] of diagrams) {
    const elementRegistry = state.modeler.get('elementRegistry');
    const elements = getVisibleElements(elementRegistry);
    list.push({
      id,
      name: state.name || '(unnamed)',
      elementCount: elements.length,
    });
  }

  return jsonResult({
    success: true,
    diagrams: list,
    count: list.length,
  });
}

export const TOOL_DEFINITION = {
  name: 'list_diagrams',
  description:
    'List all diagrams currently held in memory with their IDs, names, and element counts.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const;
