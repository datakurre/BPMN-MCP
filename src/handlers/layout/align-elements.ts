/**
 * Handler for align_bpmn_elements tool.
 *
 * Merged tool that handles both alignment and distribution of elements.
 * Supports an optional `compact` flag that, when true, also redistributes
 * elements along the perpendicular axis with ~50px edge-to-edge gaps.
 */
// @mutating

import { type ToolResult } from '../../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
} from '../helpers';
import { STANDARD_BPMN_GAP } from '../../constants';

export interface AlignElementsArgs {
  diagramId: string;
  elementIds: string[];
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
  compact?: boolean;
}

export interface DistributeElementsArgs {
  diagramId: string;
  elementIds: string[];
  orientation: 'horizontal' | 'vertical';
  gap?: number;
}

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

// ── X-axis overlap resolution (task 8a) ─────────────────────────────────────

/**
 * Detect and resolve horizontal overlaps among elements that share the
 * same Y row after alignment.
 *
 * When `compact: true` is combined with a horizontal alignment
 * (top/middle/bottom), all elements land on the same Y center line.
 * If any two elements still overlap on the X axis (e.g. from parallel
 * branches that were at different depths), this function nudges later
 * elements to the right with a STANDARD_BPMN_GAP margin.
 */
function resolveXOverlaps(elements: any[], modeling: any): void {
  // Group elements by their rounded Y-center (same row)
  const rows = new Map<number, any[]>();
  for (const el of elements) {
    const rowKey = Math.round(el.y + (el.height || 0) / 2);
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey)!.push(el);
  }

  for (const [, row] of rows) {
    if (row.length < 2) continue;
    // Sort by current X
    const sorted = [...row].sort((a: any, b: any) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const minX = prev.x + (prev.width || 0) + STANDARD_BPMN_GAP;
      if (curr.x < minX) {
        const delta = minX - curr.x;
        modeling.moveElements([curr], { x: delta, y: 0 });
        // Update position for subsequent elements
        sorted[i] = { ...curr, x: curr.x + delta };
      }
    }
  }
}

// ── Non-selected overlap resolution (TODO #4) ────────────────────────────

/**
 * After compact alignment, selected elements may overlap non-selected elements
 * that sit in the same X range (e.g. a gateway that wasn't part of the
 * selection).  Nudge each selected element rightward until it clears all
 * non-selected elements on the same Y row.
 */
function resolveAgainstNonSelected(
  selectedEls: any[],
  allEls: any[],
  selectedIds: Set<string>,
  modeling: any
): void {
  const nonSelected = allEls.filter(
    (el: any) =>
      !selectedIds.has(el.id) &&
      el.width &&
      el.height &&
      !el.type?.includes('Flow') &&
      !el.type?.includes('Lane') &&
      !el.type?.includes('Participant') &&
      !el.type?.includes('Process')
  );
  if (nonSelected.length === 0) return;

  // Work on a fresh snapshot of selected positions (elements may have moved
  // during compact redistribution, so re-read from the element objects).
  for (const sel of selectedEls) {
    let safeX = sel.x;
    // Iterate until no overlap remains (max 20 iterations to avoid infinite loops)
    for (let iter = 0; iter < 20; iter++) {
      let overlapping = false;
      for (const other of nonSelected) {
        const xOverlap = safeX < other.x + other.width && safeX + sel.width > other.x;
        const yOverlap = sel.y < other.y + other.height && sel.y + sel.height > other.y;
        if (xOverlap && yOverlap) {
          safeX = other.x + other.width + STANDARD_BPMN_GAP;
          overlapping = true;
          break;
        }
      }
      if (!overlapping) break;
    }
    if (Math.abs(safeX - sel.x) > 0.5) {
      modeling.moveElements([sel], { x: safeX - sel.x, y: 0 });
    }
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

/** Capture current flowNodeRef membership: elementId → laneId. */
function snapshotLaneMembership(lanes: any[]): Map<string, string> {
  const saved = new Map<string, string>();
  for (const lane of lanes) {
    const refs: Array<{ id: string }> = lane.businessObject?.flowNodeRef ?? [];
    for (const ref of refs) {
      if (ref?.id) saved.set(ref.id, lane.id);
    }
  }
  return saved;
}

/** Restore flowNodeRef on lanes from a previously captured snapshot. */
function restoreLaneMembership(
  lanes: any[],
  saved: Map<string, string>,
  elementRegistry: any
): void {
  if (lanes.length === 0 || saved.size === 0) return;
  const laneById = new Map<string, any>(lanes.map((l: any) => [l.id, l]));
  const affectedLaneIds = new Set<string>(saved.values());
  for (const lane of lanes) {
    if (!affectedLaneIds.has(lane.id)) continue;
    const refs = lane.businessObject?.flowNodeRef;
    if (Array.isArray(refs)) refs.length = 0;
  }
  for (const [elementId, laneId] of saved) {
    const el = elementRegistry.get(elementId);
    const lane = laneById.get(laneId);
    if (!el || !lane?.businessObject) continue;
    const laneBo = lane.businessObject;
    if (!Array.isArray(laneBo.flowNodeRef)) laneBo.flowNodeRef = [];
    const elBo = el.businessObject;
    if (elBo && !laneBo.flowNodeRef.includes(elBo)) laneBo.flowNodeRef.push(elBo);
  }
}

export async function handleAlignElements(args: AlignElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementIds', 'alignment']);
  const { diagramId, elementIds, alignment, compact } = args;
  const diagram = requireDiagram(diagramId);

  if (elementIds.length < 2) {
    throw new McpError(ErrorCode.InvalidRequest, 'Alignment requires at least 2 elements');
  }

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const elements = elementIds.map((id) => requireElement(elementRegistry, id));

  // ── Fix #5: snapshot lane assignments before any moves ──────────────────
  // bpmn-js silently mutates lane.businessObject.flowNodeRef when elements
  // are moved across lane boundaries.  Capture the intended membership now
  // so we can restore it after alignment.
  const lanes: any[] = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');
  const savedLaneMembership = snapshotLaneMembership(lanes);

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
    // For horizontal alignments (top/middle/bottom), elements land on the
    // same Y row.  Resolve any remaining X overlaps (task 8a): parallel
    // branch elements may have identical X coordinates after alignment.
    if (['top', 'middle', 'bottom'].includes(alignment)) {
      resolveXOverlaps(elements, modeling);
      // TODO #4: also push selected elements past any non-selected elements
      // they now overlap (e.g. a join gateway that wasn't in the selection).
      const selectedIds = new Set(elementIds);
      const allEls: any[] = elementRegistry.getAll();
      resolveAgainstNonSelected(elements, allEls, selectedIds, modeling);
    }
  }
  // Restore lane membership so that compact redistribution
  // by vertical element moves does not corrupt the exported XML.
  restoreLaneMembership(lanes, savedLaneMembership, elementRegistry);

  await syncXml(diagram);

  return jsonResult({
    success: true,
    alignment,
    compact: compact || false,
    alignedCount: elements.length,
    message: `Aligned ${elements.length} elements to ${alignment}${compact ? ' (compact)' : ''}`,
  });
}

// ── Distribute handler ─────────────────────────────────────────────────────

type Axis = 'x' | 'y';
type Dim = 'width' | 'height';

/** Distribute elements with a fixed gap between edges. */
function distributeFixedGap(sorted: any[], gap: number, axis: Axis, dim: Dim, modeling: any): void {
  let current = sorted[0][axis] + (sorted[0][dim] || 0) + gap;
  for (let i = 1; i < sorted.length; i++) {
    const el = sorted[i];
    const delta = current - el[axis];
    if (Math.abs(delta) > 0.5) {
      const move = axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta };
      modeling.moveElements([el], move);
    }
    current += (el[dim] || 0) + gap;
  }
}

/** Distribute elements evenly within existing span (edge-to-edge). */
function distributeEven(sorted: any[], axis: Axis, dim: Dim, modeling: any): void {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = last[axis] + (last[dim] || 0) - first[axis];
  const totalSize = sorted.reduce((sum: number, el: any) => sum + (el[dim] || 0), 0);
  const computedGap = (totalSpan - totalSize) / (sorted.length - 1);

  let current = first[axis] + (first[dim] || 0) + computedGap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const el = sorted[i];
    const delta = current - el[axis];
    if (Math.abs(delta) > 0.5) {
      const move = axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta };
      modeling.moveElements([el], move);
    }
    current += (el[dim] || 0) + computedGap;
  }
}

export async function handleDistributeElements(args: DistributeElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementIds', 'orientation']);
  const { diagramId, elementIds, orientation, gap } = args;
  const diagram = requireDiagram(diagramId);

  if (elementIds.length < 3) {
    throw new McpError(ErrorCode.InvalidRequest, 'Distribution requires at least 3 elements');
  }

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const elements = elementIds.map((id) => requireElement(elementRegistry, id));

  const axis: Axis = orientation === 'horizontal' ? 'x' : 'y';
  const dim: Dim = orientation === 'horizontal' ? 'width' : 'height';
  const sorted = [...elements].sort((a: any, b: any) => a[axis] - b[axis]);

  if (gap !== undefined) {
    distributeFixedGap(sorted, gap, axis, dim, modeling);
  } else {
    distributeEven(sorted, axis, dim, modeling);
  }

  await syncXml(diagram);

  return jsonResult({
    success: true,
    orientation,
    distributedCount: elements.length,
    gap: gap ?? 'auto',
    message: `Distributed ${elements.length} elements ${orientation}ly${gap !== undefined ? ` with ${gap}px gap` : ''}`,
  });
}

export const TOOL_DEFINITION = {
  name: 'align_bpmn_elements',
  description:
    'Align or distribute selected elements. Supports two operations: ' +
    '(1) **align** — align elements along an axis (left, center, right, top, middle, bottom), requires at least 2 elements. Use compact=true to also redistribute with ~50px gaps. ' +
    '(2) **distribute** — evenly distribute elements horizontally or vertically using edge-to-edge spacing, requires at least 3 elements. Use gap for exact pixel spacing (recommended: 50). ' +
    '⚠️ **Warning:** `alignment: middle` on a process with parallel branches collapses all branches onto a single Y row, causing horizontal overlaps. Use `layout_bpmn_diagram` instead to re-arrange the full diagram while preserving branch separation. ' +
    'If you must use `alignment: middle`, pass `compact: true` to detect and spread overlapping elements on the X axis afterwards.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of element IDs to align or distribute',
      },
      alignment: {
        type: 'string',
        enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
        description: 'The alignment direction (for align operation)',
      },
      compact: {
        type: 'boolean',
        description:
          'When true (align operation), also redistributes elements along the perpendicular axis with ~50px edge-to-edge gaps.',
      },
      orientation: {
        type: 'string',
        enum: ['horizontal', 'vertical'],
        description: 'Distribution direction (for distribute operation)',
      },
      gap: {
        type: 'number',
        description:
          'Fixed edge-to-edge gap in pixels between elements (for distribute operation). Standard BPMN spacing is ~50px. When omitted, elements are evenly distributed within their current span.',
      },
    },
    required: ['diagramId', 'elementIds'],
  },
} as const;
