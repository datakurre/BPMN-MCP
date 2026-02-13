/**
 * Geometry helpers for flow (connection) label positioning.
 *
 * Detects L-shaped and Z-shaped flow routes and computes the preferred
 * segment and midpoint for label placement.
 *
 * Pure functions — no bpmn-js dependency, just math.
 */

import { type Point } from './label-utils';
import { ARROW_HEAD_LENGTH } from '../../../constants';

/** Tolerance (px) for treating two coordinates as collinear. */
const COLLINEAR_TOLERANCE = 2;

/** Check if a segment is vertical (same X within tolerance). */
function isVerticalSegment(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < COLLINEAR_TOLERANCE;
}

/** Check if a segment is horizontal (same Y within tolerance). */
function isHorizontalSegment(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.y - b.y) < COLLINEAR_TOLERANCE;
}

/**
 * Identify the preferred label segment for L-shaped and Z-shaped flows.
 *
 * For L-shaped flows (3 waypoints), returns the vertical segment index
 * so the label is placed at the center of the distinctive branch part.
 *
 * For Z-shaped flows (4 waypoints), returns the middle (vertical) segment
 * index, which is the segment that distinguishes the branch.
 *
 * Returns -1 when no preferred segment is identified (fall back to
 * path-midpoint algorithm).
 */
export function findPreferredLabelSegmentIndex(waypoints: Array<{ x: number; y: number }>): number {
  // L-shaped: 3 waypoints, one horizontal + one vertical segment
  if (waypoints.length === 3) {
    const seg0Vert = isVerticalSegment(waypoints[0], waypoints[1]);
    const seg0Horiz = isHorizontalSegment(waypoints[0], waypoints[1]);
    const seg1Vert = isVerticalSegment(waypoints[1], waypoints[2]);
    const seg1Horiz = isHorizontalSegment(waypoints[1], waypoints[2]);

    // Horizontal then vertical → label on the vertical part (segment 1)
    if (seg0Horiz && seg1Vert) return 1;
    // Vertical then horizontal → label on the vertical part (segment 0)
    if (seg0Vert && seg1Horiz) return 0;
  }

  // Z-shaped: 4 waypoints, horizontal + vertical + horizontal (or v+h+v)
  if (waypoints.length === 4) {
    // The middle segment (index 1) is the distinctive connector between
    // the two parallel runs.
    const seg0Horiz = isHorizontalSegment(waypoints[0], waypoints[1]);
    const seg1Vert = isVerticalSegment(waypoints[1], waypoints[2]);
    const seg2Horiz = isHorizontalSegment(waypoints[2], waypoints[3]);
    if (seg0Horiz && seg1Vert && seg2Horiz) return 1;

    const seg0Vert = isVerticalSegment(waypoints[0], waypoints[1]);
    const seg1Horiz = isHorizontalSegment(waypoints[1], waypoints[2]);
    const seg2Vert = isVerticalSegment(waypoints[2], waypoints[3]);
    if (seg0Vert && seg1Horiz && seg2Vert) return 1;
  }

  return -1;
}

/**
 * Compute the midpoint of a flow's waypoints for label placement.
 *
 * For a 2-waypoint flow, this is the geometric midpoint of the single
 * segment.
 *
 * For L-shaped flows (3 waypoints: horizontal→vertical or
 * vertical→horizontal), the midpoint is placed at the center of the
 * vertical segment — the distinctive branch part where labels are
 * easiest to read.
 *
 * For Z-shaped flows (4 waypoints: H→V→H or V→H→V), the midpoint is
 * placed at the center of the middle segment.
 *
 * For other multi-waypoint flows, walks 50% of the total path length
 * to find the exact midpoint, which may fall on any segment.
 */
export function computeFlowMidpoint(waypoints: Array<{ x: number; y: number }>): Point {
  if (waypoints.length === 2) {
    // Subtract the arrow head from the target end so the midpoint
    // sits at the visual centre of the visible connection line.
    const dx = waypoints[1].x - waypoints[0].x;
    const dy = waypoints[1].y - waypoints[0].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const effectiveEndX = waypoints[1].x - (ARROW_HEAD_LENGTH * dx) / len;
    const effectiveEndY = waypoints[1].y - (ARROW_HEAD_LENGTH * dy) / len;
    return {
      x: (waypoints[0].x + effectiveEndX) / 2,
      y: (waypoints[0].y + effectiveEndY) / 2,
    };
  }

  // For L-shaped and Z-shaped flows, prefer the vertical/middle segment
  const preferredIdx = findPreferredLabelSegmentIndex(waypoints);
  if (preferredIdx >= 0) {
    const a = waypoints[preferredIdx];
    const b = waypoints[preferredIdx + 1];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  // General case: walk to 50% of total path length.
  // Subtract the arrow head so labels centre on the visible portion.
  let totalLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }

  const halfLength = Math.max(0, totalLength - ARROW_HEAD_LENGTH) / 2;
  let walked = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (walked + segLen >= halfLength && segLen > 0) {
      const t = (halfLength - walked) / segLen;
      return {
        x: waypoints[i - 1].x + dx * t,
        y: waypoints[i - 1].y + dy * t,
      };
    }
    walked += segLen;
  }

  // Fallback: geometric midpoint of first and last
  return {
    x: (waypoints[0].x + waypoints[waypoints.length - 1].x) / 2,
    y: (waypoints[0].y + waypoints[waypoints.length - 1].y) / 2,
  };
}
