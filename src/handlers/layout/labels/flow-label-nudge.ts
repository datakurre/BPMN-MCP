/**
 * Flow label nudge helpers: overlap detection, scoring, and nudge computation.
 *
 * Extracted from adjust-flow-labels.ts for file-size compliance.
 */

import { FLOW_LABEL_INDENT, LABEL_SHAPE_PROXIMITY_MARGIN } from '../../../constants';
import {
  type Point,
  type Rect,
  rectsOverlap,
  rectsNearby,
  segmentIntersectsRect,
} from './label-utils';

// ── Shape and segment indexing ─────────────────────────────────────────────

/** Indexed shape rects: parallel arrays of Rects and their element IDs. */
export interface ShapeRectIndex {
  rects: Rect[];
  ids: string[];
}

/** Build shape rects with element IDs for per-flow endpoint exclusion. */
export function buildShapeRectIndex(elements: any[]): ShapeRectIndex {
  const shapes = elements.filter(
    (el: any) =>
      el.type &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.width &&
      el.height
  );
  return {
    rects: shapes.map((el: any) => ({
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    })),
    ids: shapes.map((el: any) => el.id),
  };
}

/**
 * Return shape rects excluding the flow's own source and target.
 * A flow label is expected to be near its endpoints — nudging it away
 * from them is counterproductive, especially for short connections.
 */
export function getNonEndpointShapes(
  index: ShapeRectIndex,
  sourceId?: string,
  targetId?: string
): Rect[] {
  const result: Rect[] = [];
  for (let i = 0; i < index.rects.length; i++) {
    if (index.ids[i] !== sourceId && index.ids[i] !== targetId) {
      result.push(index.rects[i]);
    }
  }
  return result;
}

/** Indexed connection segments for per-flow exclusion. */
export interface ConnectionSegmentIndex {
  segments: [Point, Point][];
  flowIds: string[];
}

/** Collect all connection segments with their flow IDs. */
export function collectConnectionSegmentIndex(elements: any[]): ConnectionSegmentIndex {
  const segments: [Point, Point][] = [];
  const flowIds: string[] = [];
  for (const el of elements) {
    if (
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints?.length >= 2
    ) {
      for (let i = 0; i < el.waypoints.length - 1; i++) {
        segments.push([
          { x: el.waypoints[i].x, y: el.waypoints[i].y },
          { x: el.waypoints[i + 1].x, y: el.waypoints[i + 1].y },
        ]);
        flowIds.push(el.id);
      }
    }
  }
  return { segments, flowIds };
}

/** Get connection segments excluding a specific flow's own segments. */
export function getNonOwnSegments(
  index: ConnectionSegmentIndex,
  excludeFlowId: string
): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 0; i < index.segments.length; i++) {
    if (index.flowIds[i] !== excludeFlowId) {
      result.push(index.segments[i]);
    }
  }
  return result;
}

/** Get a specific flow's own segments. */
export function getOwnSegments(index: ConnectionSegmentIndex, flowId: string): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 0; i < index.segments.length; i++) {
    if (index.flowIds[i] === flowId) {
      result.push(index.segments[i]);
    }
  }
  return result;
}

// ── Scoring and nudge computation ──────────────────────────────────────────

/** Score a nudge candidate for a flow label. Lower is better (0 = no overlap). */
function scoreNudgedRect(
  nudgedRect: Rect,
  shapeRects: Rect[],
  otherFlowLabels: Rect[],
  connectionSegments: [Point, Point][]
): number {
  let score = 0;
  if (shapeRects.some((sr) => rectsOverlap(nudgedRect, sr))) {
    score += 5;
  } else if (shapeRects.some((sr) => rectsNearby(nudgedRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN))) {
    score += 1;
  }
  if (otherFlowLabels.some((lr) => rectsOverlap(nudgedRect, lr))) score += 3;
  for (const [s1, s2] of connectionSegments) {
    if (segmentIntersectsRect(s1, s2, nudgedRect)) score += 1;
  }
  return score;
}

/**
 * Find a small nudge to move a flow label off its own flow line.
 * Uses a minimal perpendicular displacement (10–15px) so the label
 * remains adjacent to but no longer overlapping the flow path.
 */
export function findSelfFlowNudge(
  labelRect: Rect,
  perpX: number,
  perpY: number,
  ownSegments: [Point, Point][]
): { x: number; y: number } | null {
  const nudgeDistances = [10, 15];
  let bestNudge: { x: number; y: number } | null = null;

  for (const amount of nudgeDistances) {
    for (const sign of [1, -1]) {
      const nudge = { x: perpX * amount * sign, y: perpY * amount * sign };
      const nudgedRect: Rect = {
        x: labelRect.x + nudge.x,
        y: labelRect.y + nudge.y,
        width: labelRect.width,
        height: labelRect.height,
      };
      const cleared = !ownSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, nudgedRect));
      if (cleared) {
        bestNudge = nudge;
        break;
      }
    }
    if (bestNudge) break;
  }

  return bestNudge;
}

/** Find the best nudge direction/distance for a flow label. */
export function findBestNudge(
  labelRect: Rect,
  perpX: number,
  perpY: number,
  shapeRects: Rect[],
  otherFlowLabels: Rect[],
  connectionSegments: [Point, Point][]
): { x: number; y: number } | null {
  const nudgeDistances = [FLOW_LABEL_INDENT + 10, FLOW_LABEL_INDENT + 25];
  let bestNudge: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const amount of nudgeDistances) {
    for (const sign of [1, -1]) {
      const nudge = { x: perpX * amount * sign, y: perpY * amount * sign };
      const nudgedRect: Rect = {
        x: labelRect.x + nudge.x,
        y: labelRect.y + nudge.y,
        width: labelRect.width,
        height: labelRect.height,
      };
      const score = scoreNudgedRect(nudgedRect, shapeRects, otherFlowLabels, connectionSegments);
      if (score < bestScore) {
        bestScore = score;
        bestNudge = nudge;
        if (score === 0) break;
      }
    }
    if (bestScore === 0) break;
  }

  return bestNudge;
}

// ── Overlap detection ──────────────────────────────────────────────────────

/** Overlap flags for a flow label. */
export interface FlowLabelOverlaps {
  overlapsShape: boolean;
  tooCloseToShape: boolean;
  overlapsLabel: boolean;
  crossesConnection: boolean;
  crossesOwnFlow: boolean;
}

/** Detect all overlap conditions for a flow label. */
export function detectFlowLabelOverlaps(
  labelRect: Rect,
  shapes: Rect[],
  otherFlowLabels: Rect[],
  otherSegments: [Point, Point][],
  ownSegments: [Point, Point][]
): FlowLabelOverlaps {
  return {
    overlapsShape: shapes.some((sr) => rectsOverlap(labelRect, sr)),
    tooCloseToShape: shapes.some((sr) => rectsNearby(labelRect, sr, LABEL_SHAPE_PROXIMITY_MARGIN)),
    overlapsLabel: otherFlowLabels.some((lr) => rectsOverlap(labelRect, lr)),
    crossesConnection: otherSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, labelRect)),
    crossesOwnFlow: ownSegments.some(([p1, p2]) => segmentIntersectsRect(p1, p2, labelRect)),
  };
}

/** Check if any overlap condition is true. */
export function hasAnyOverlap(o: FlowLabelOverlaps): boolean {
  return (
    o.overlapsShape ||
    o.tooCloseToShape ||
    o.overlapsLabel ||
    o.crossesConnection ||
    o.crossesOwnFlow
  );
}
