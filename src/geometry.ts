/**
 * Shared geometry utilities for bounding-box overlap detection,
 * segment intersection tests, and waypoint manipulation.
 *
 * Pure functions — no bpmn-js dependency, just math.
 *
 * Extracted from elk/overlap-resolution, elk/crossing-detection,
 * handlers/layout/labels/label-utils, and bpmnlint-plugin rules
 * to eliminate cross-module duplication.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Bounding-box overlap ───────────────────────────────────────────────────

/** Check if two axis-aligned rectangles overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Check if two axis-aligned rectangles are within `margin` pixels of each other.
 * Returns true if the rects overlap OR the gap between them is ≤ margin.
 */
export function rectsNearby(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

// ── Line segment ↔ rectangle intersection ──────────────────────────────────

/**
 * Cohen-Sutherland outcodes for a point relative to a rectangle.
 */
function outcode(px: number, py: number, rect: Rect): number {
  let code = 0;
  if (px < rect.x) {
    code |= 1; // LEFT
  } else if (px > rect.x + rect.width) {
    code |= 2; // RIGHT
  }
  if (py < rect.y) {
    code |= 4; // TOP
  } else if (py > rect.y + rect.height) {
    code |= 8; // BOTTOM
  }
  return code;
}

/**
 * Test whether line segment (p1→p2) intersects an axis-aligned rectangle.
 * Uses the Cohen-Sutherland algorithm.
 */
export function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect): boolean {
  let x0 = p1.x,
    y0 = p1.y,
    x1 = p2.x,
    y1 = p2.y;
  let code0 = outcode(x0, y0, rect);
  let code1 = outcode(x1, y1, rect);

  for (;;) {
    if ((code0 | code1) === 0) return true; // both inside
    if ((code0 & code1) !== 0) return false; // both outside same side

    const codeOut = code0 !== 0 ? code0 : code1;
    let x = 0,
      y = 0;
    const xMin = rect.x,
      xMax = rect.x + rect.width;
    const yMin = rect.y,
      yMax = rect.y + rect.height;

    if (codeOut & 8) {
      // BOTTOM
      x = x0 + ((x1 - x0) * (yMax - y0)) / (y1 - y0);
      y = yMax;
    } else if (codeOut & 4) {
      // TOP
      x = x0 + ((x1 - x0) * (yMin - y0)) / (y1 - y0);
      y = yMin;
    } else if (codeOut & 2) {
      // RIGHT
      y = y0 + ((y1 - y0) * (xMax - x0)) / (x1 - x0);
      x = xMax;
    } else if (codeOut & 1) {
      // LEFT
      y = y0 + ((y1 - y0) * (xMin - x0)) / (x1 - x0);
      x = xMin;
    }

    if (codeOut === code0) {
      x0 = x;
      y0 = y;
      code0 = outcode(x0, y0, rect);
    } else {
      x1 = x;
      y1 = y;
      code1 = outcode(x1, y1, rect);
    }
  }
}

// ── Line segment ↔ segment intersection ────────────────────────────────────

/**
 * Cross product of vectors (o→a) and (o→b).
 */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Test whether two line segments intersect (excluding collinear overlap).
 * Uses the cross-product orientation test.
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

// ── Waypoint helpers ───────────────────────────────────────────────────────

/**
 * Deep-clone an array of waypoints to plain `{ x, y }` objects.
 *
 * Strips any extra properties (e.g. bpmn-js `original` references)
 * and avoids mutating the source waypoints.
 */
export function cloneWaypoints(wps: ReadonlyArray<{ x: number; y: number }>): Point[] {
  return wps.map((wp) => ({ x: wp.x, y: wp.y }));
}
