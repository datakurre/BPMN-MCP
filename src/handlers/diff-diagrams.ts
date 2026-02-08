/**
 * Handler for diff_bpmn_diagrams tool.
 *
 * Compares two diagrams and returns a structured diff of additions,
 * removals, and changes.
 */

import { type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from './helpers';

export interface DiffDiagramsArgs {
  diagramIdA: string;
  diagramIdB: string;
}

interface ElementSummary {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
}

interface ElementDiff {
  elementId: string;
  type: string;
  changes: Array<{ property: string; oldValue: any; newValue: any }>;
}

function summariseElement(el: any): ElementSummary {
  return {
    id: el.id,
    type: el.type,
    name: el.businessObject?.name,
    x: el.x,
    y: el.y,
  };
}

type PropertyChange = { property: string; oldValue: any; newValue: any };

function compareElements(elA: any, elB: any): PropertyChange[] {
  const changes: PropertyChange[] = [];

  // Compare name
  const nameA = elA.businessObject?.name;
  const nameB = elB.businessObject?.name;
  if (nameA !== nameB) {
    changes.push({ property: 'name', oldValue: nameA, newValue: nameB });
  }

  // Compare type
  if (elA.type !== elB.type) {
    changes.push({ property: 'type', oldValue: elA.type, newValue: elB.type });
  }

  // Compare position (with tolerance)
  if (Math.abs((elA.x || 0) - (elB.x || 0)) > 1 || Math.abs((elA.y || 0) - (elB.y || 0)) > 1) {
    changes.push({
      property: 'position',
      oldValue: { x: elA.x, y: elA.y },
      newValue: { x: elB.x, y: elB.y },
    });
  }

  // Compare connections
  const inA = (elA.incoming || []).map((c: any) => c.id).sort();
  const inB = (elB.incoming || []).map((c: any) => c.id).sort();
  if (JSON.stringify(inA) !== JSON.stringify(inB)) {
    changes.push({ property: 'incoming', oldValue: inA, newValue: inB });
  }

  const outA = (elA.outgoing || []).map((c: any) => c.id).sort();
  const outB = (elB.outgoing || []).map((c: any) => c.id).sort();
  if (JSON.stringify(outA) !== JSON.stringify(outB)) {
    changes.push({ property: 'outgoing', oldValue: outA, newValue: outB });
  }

  return changes;
}

function computeDiff(
  mapA: Map<string, any>,
  mapB: Map<string, any>
): { added: ElementSummary[]; removed: ElementSummary[]; changed: ElementDiff[] } {
  const added: ElementSummary[] = [];
  const removed: ElementSummary[] = [];
  const changed: ElementDiff[] = [];

  for (const [id, el] of mapB) {
    if (!mapA.has(id)) added.push(summariseElement(el));
  }

  for (const [id, el] of mapA) {
    if (!mapB.has(id)) removed.push(summariseElement(el));
  }

  for (const [id, elA] of mapA) {
    const elB = mapB.get(id);
    if (!elB) continue;
    const changes = compareElements(elA, elB);
    if (changes.length > 0) {
      changed.push({ elementId: id, type: elA.type, changes });
    }
  }

  return { added, removed, changed };
}

export async function handleDiffDiagrams(args: DiffDiagramsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramIdA', 'diagramIdB']);
  const { diagramIdA, diagramIdB } = args;

  const diagramA = requireDiagram(diagramIdA);
  const diagramB = requireDiagram(diagramIdB);

  const registryA = diagramA.modeler.get('elementRegistry');
  const registryB = diagramB.modeler.get('elementRegistry');

  const elementsA = getVisibleElements(registryA);
  const elementsB = getVisibleElements(registryB);

  const mapA = new Map<string, any>(elementsA.map((el: any) => [el.id, el]));
  const mapB = new Map<string, any>(elementsB.map((el: any) => [el.id, el]));

  const { added, removed, changed } = computeDiff(mapA, mapB);

  return jsonResult({
    success: true,
    diagramA: diagramIdA,
    diagramB: diagramIdB,
    added: added,
    removed: removed,
    changed: changed,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      identical: added.length === 0 && removed.length === 0 && changed.length === 0,
    },
  });
}

export const TOOL_DEFINITION = {
  name: 'diff_bpmn_diagrams',
  description:
    'Compare two BPMN diagrams and return a structured diff of additions, removals, and changes. Useful for reviewing AI-generated modifications.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramIdA: {
        type: 'string',
        description: 'The ID of the first (base) diagram',
      },
      diagramIdB: {
        type: 'string',
        description: 'The ID of the second (changed) diagram',
      },
    },
    required: ['diagramIdA', 'diagramIdB'],
  },
} as const;
