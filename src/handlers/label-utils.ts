/**
 * Geometry helpers for label-overlap detection and resolution.
 *
 * Pure functions — no bpmn-js dependency, just math.
 */

import {
  ELEMENT_LABEL_DISTANCE,
  DEFAULT_LABEL_SIZE,
  LABEL_POSITION_PRIORITY,
} from "../constants";

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

export type LabelOrientation = "top" | "bottom" | "left" | "right";

export interface LabelCandidate {
  orientation: LabelOrientation;
  rect: Rect;
}

// ── Bounding-box overlap ───────────────────────────────────────────────────

/** Check if two axis-aligned rectangles overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ── Line segment ↔ rectangle intersection ──────────────────────────────────

/**
 * Cohen-Sutherland outcodes for a point relative to a rectangle.
 */
function outcode(px: number, py: number, rect: Rect): number {
  let code = 0;
  if (px < rect.x) code |= 1;            // LEFT
  else if (px > rect.x + rect.width) code |= 2;  // RIGHT
  if (py < rect.y) code |= 4;            // TOP
  else if (py > rect.y + rect.height) code |= 8;  // BOTTOM
  return code;
}

/**
 * Test whether line segment (p1→p2) intersects an axis-aligned rectangle.
 * Uses the Cohen-Sutherland algorithm.
 */
export function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect): boolean {
  let x0 = p1.x, y0 = p1.y, x1 = p2.x, y1 = p2.y;
  let code0 = outcode(x0, y0, rect);
  let code1 = outcode(x1, y1, rect);

  for (;;) {
    if ((code0 | code1) === 0) return true;   // both inside
    if ((code0 & code1) !== 0) return false;  // both outside same side

    const codeOut = code0 !== 0 ? code0 : code1;
    let x = 0, y = 0;
    const xMin = rect.x, xMax = rect.x + rect.width;
    const yMin = rect.y, yMax = rect.y + rect.height;

    if (codeOut & 8) {        // BOTTOM
      x = x0 + (x1 - x0) * (yMax - y0) / (y1 - y0);
      y = yMax;
    } else if (codeOut & 4) { // TOP
      x = x0 + (x1 - x0) * (yMin - y0) / (y1 - y0);
      y = yMin;
    } else if (codeOut & 2) { // RIGHT
      y = y0 + (y1 - y0) * (xMax - x0) / (x1 - x0);
      x = xMax;
    } else if (codeOut & 1) { // LEFT
      y = y0 + (y1 - y0) * (xMin - x0) / (x1 - x0);
      x = xMin;
    }

    if (codeOut === code0) {
      x0 = x; y0 = y;
      code0 = outcode(x0, y0, rect);
    } else {
      x1 = x; y1 = y;
      code1 = outcode(x1, y1, rect);
    }
  }
}

// ── Label candidate positions ──────────────────────────────────────────────

/**
 * Generate 4 candidate label positions around an element.
 *
 * Each candidate is centred on the relevant edge, offset by
 * `ELEMENT_LABEL_DISTANCE`.
 */
export function getLabelCandidatePositions(element: {
  x: number;
  y: number;
  width: number;
  height: number;
}): LabelCandidate[] {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const lw = DEFAULT_LABEL_SIZE.width;
  const lh = DEFAULT_LABEL_SIZE.height;
  const gap = ELEMENT_LABEL_DISTANCE;

  return LABEL_POSITION_PRIORITY.map((orientation) => {
    let rect: Rect;
    switch (orientation) {
      case "top":
        rect = { x: midX - lw / 2, y: element.y - gap - lh, width: lw, height: lh };
        break;
      case "bottom":
        rect = { x: midX - lw / 2, y: element.y + element.height + gap, width: lw, height: lh };
        break;
      case "left":
        rect = { x: element.x - gap - lw, y: midY - lh / 2, width: lw, height: lh };
        break;
      case "right":
        rect = { x: element.x + element.width + gap, y: midY - lh / 2, width: lw, height: lh };
        break;
    }
    return { orientation, rect };
  });
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Score a candidate label position.
 *
 * Returns 0 for no collisions.  Higher = worse.
 *
 * @param candidateRect  The label's bounding box at the candidate position.
 * @param connectionSegments  All connection segments in the diagram as pairs of points.
 * @param otherLabelRects  Bounding boxes of other external labels.
 * @param hostRect  Optional host-element rect (for boundary events) to exclude.
 */
export function scoreLabelPosition(
  candidateRect: Rect,
  connectionSegments: [Point, Point][],
  otherLabelRects: Rect[],
  hostRect?: Rect,
): number {
  let score = 0;

  // Penalty for intersecting connection segments
  for (const [p1, p2] of connectionSegments) {
    if (segmentIntersectsRect(p1, p2, candidateRect)) {
      score += 1;
    }
  }

  // Penalty for overlapping other labels
  for (const lr of otherLabelRects) {
    if (rectsOverlap(candidateRect, lr)) {
      score += 2; // labels overlapping is worse than crossing a connection
    }
  }

  // Penalty for overlapping host element (boundary events)
  if (hostRect && rectsOverlap(candidateRect, hostRect)) {
    score += 10; // very bad — label hidden behind host
  }

  return score;
}
