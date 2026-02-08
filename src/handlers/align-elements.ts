/**
 * Handler for align_bpmn_elements tool.
 *
 * Supports an optional `compact` flag that, when true, also redistributes
 * elements along the perpendicular axis with ~50px edge-to-edge gaps.
 */

import { type AlignElementsArgs, type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { STANDARD_BPMN_GAP } from '../constants';

// ── Pure alignment computation ─────────────────────────────────────────────

interface Delta {
  x: number;
  y: number;
}

/**
 * Compute the move delta for each element to satisfy the given alignment.
 * Returns a map from element index to its {dx, dy}.
 */
function computeAlignmentDeltas(elements: any[], alignment: string): Delta[] {
  let targetValue: number;

  switch (alignment) {
    case 'left':
      targetValue = Math.min(...elements.map((el: any) => el.x));
      return elements.map((el: any) => ({ x: targetValue - el.x, y: 0 }));
    case 'right':
      targetValue = Math.max(...elements.map((el: any) => el.x + (el.width || 0)));
      return elements.map((el: any) => ({
        x: targetValue - (el.x + (el.width || 0)),
        y: 0,
      }));
    case 'center': {
      const minX = Math.min(...elements.map((el: any) => el.x));
      const maxX = Math.max(...elements.map((el: any) => el.x + (el.width || 0)));
      const centerX = (minX + maxX) / 2;
      return elements.map((el: any) => ({
        x: centerX - (el.x + (el.width || 0) / 2),
        y: 0,
      }));
    }
    case 'top':
      targetValue = Math.min(...elements.map((el: any) => el.y));
      return elements.map((el: any) => ({ x: 0, y: targetValue - el.y }));
    case 'bottom':
      targetValue = Math.max(...elements.map((el: any) => el.y + (el.height || 0)));
      return elements.map((el: any) => ({
        x: 0,
        y: targetValue - (el.y + (el.height || 0)),
      }));
    case 'middle': {
      const minY = Math.min(...elements.map((el: any) => el.y));
      const maxY = Math.max(...elements.map((el: any) => el.y + (el.height || 0)));
      const centerY = (minY + maxY) / 2;
      return elements.map((el: any) => ({
        x: 0,
        y: centerY - (el.y + (el.height || 0) / 2),
      }));
    }
    default:
      return elements.map(() => ({ x: 0, y: 0 }));
  }
}

// ── Compact redistribution ─────────────────────────────────────────────────

/**
 * Redistribute elements along the perpendicular axis with STANDARD_BPMN_GAP.
 */
function applyCompactRedistribution(elements: any[], alignment: string, modeling: any): void {
  const isHorizontalAlignment = ['top', 'middle', 'bottom'].includes(alignment);

  if (isHorizontalAlignment) {
    const sorted = [...elements].sort((a: any, b: any) => a.x - b.x);
    let currentX = sorted[0].x + (sorted[0].width || 0) + STANDARD_BPMN_GAP;
    for (let i = 1; i < sorted.length; i++) {
      const el = sorted[i];
      const deltaX = currentX - el.x;
      if (Math.abs(deltaX) > 0.5) {
        modeling.moveElements([el], { x: deltaX, y: 0 });
      }
      currentX += (el.width || 0) + STANDARD_BPMN_GAP;
    }
  } else {
    const sorted = [...elements].sort((a: any, b: any) => a.y - b.y);
    let currentY = sorted[0].y + (sorted[0].height || 0) + STANDARD_BPMN_GAP;
    for (let i = 1; i < sorted.length; i++) {
      const el = sorted[i];
      const deltaY = currentY - el.y;
      if (Math.abs(deltaY) > 0.5) {
        modeling.moveElements([el], { x: 0, y: deltaY });
      }
      currentY += (el.height || 0) + STANDARD_BPMN_GAP;
    }
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleAlignElements(args: AlignElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementIds', 'alignment']);
  const { diagramId, elementIds, alignment, compact } = args;
  const diagram = requireDiagram(diagramId);

  if (elementIds.length < 2) {
    throw new McpError(ErrorCode.InvalidRequest, 'Alignment requires at least 2 elements');
  }

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const elements = elementIds.map((id) => requireElement(elementRegistry, id));

  // Compute and apply alignment moves
  const deltas = computeAlignmentDeltas(elements, alignment);
  for (let i = 0; i < elements.length; i++) {
    const { x, y } = deltas[i];
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      modeling.moveElements([elements[i]], { x, y });
    }
  }

  // Optional compact redistribution
  if (compact && elements.length >= 2) {
    applyCompactRedistribution(elements, alignment, modeling);
  }

  await syncXml(diagram);

  return jsonResult({
    success: true,
    alignment,
    compact: compact || false,
    alignedCount: elements.length,
    message: `Aligned ${elements.length} elements to ${alignment}${compact ? ' (compact)' : ''}`,
  });
}

export const TOOL_DEFINITION = {
  name: 'align_bpmn_elements',
  description:
    'Align selected elements along a given axis (left, center, right, top, middle, bottom). Requires at least 2 elements. Use compact=true to also redistribute elements with ~50px gaps along the perpendicular axis, or call distribute_bpmn_elements separately.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of element IDs to align',
      },
      alignment: {
        type: 'string',
        enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
        description: 'The alignment direction',
      },
      compact: {
        type: 'boolean',
        description:
          'When true, also redistributes elements along the perpendicular axis with ~50px edge-to-edge gaps for a cleaner layout.',
      },
    },
    required: ['diagramId', 'elementIds', 'alignment'],
  },
} as const;
