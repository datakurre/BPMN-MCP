/**
 * Simple 2D spatial index (grid-based) for fast proximity queries.
 *
 * Used by overlap-resolution and element-avoidance to reduce O(n²) all-pairs
 * comparisons to O(n × k) where k is the average number of elements per
 * grid cell neighbourhood — typically much smaller than n for sparse diagrams.
 *
 * H2 / H3: replace all-pairs scans with grid-cell neighbour queries.
 */

import type { BpmnElement } from '../bpmn-types';
import type { Point, Rect } from '../geometry';

// ── Typed entry ──────────────────────────────────────────────────────────────

export interface SpatialEntry {
  element: BpmnElement;
  rect: Rect;
}

// ── SpatialGrid ──────────────────────────────────────────────────────────────

/**
 * Uniform grid spatial index.
 *
 * Inserts rectangular elements into all overlapping grid cells.  Candidate
 * queries return a de-duplicated set of elements whose bounding box overlaps
 * the query rectangle.
 *
 * Cell size should be chosen to be somewhat larger than the average element
 * width/height so that most elements span only 1–4 cells.
 */
export class SpatialGrid {
  private readonly cells: Map<number, SpatialEntry[]> = new Map();
  private readonly invCellW: number;
  private readonly invCellH: number;
  private readonly cellW: number;
  private readonly cellH: number;

  constructor(cellW = 200, cellH = 200) {
    this.cellW = cellW;
    this.cellH = cellH;
    this.invCellW = 1 / cellW;
    this.invCellH = 1 / cellH;
  }

  private key(cx: number, cy: number): number {
    // Pack two 16-bit integers into one number (handles diagrams up to 65535 × 65535 cells)
    // Offset by 1000 to handle negative coordinates (elements can have x < 0 during layout)
    return (cx + 1000) * 65536 + (cy + 1000);
  }

  /** Add an element to the index. */
  add(element: BpmnElement): void {
    const x = element.x ?? 0;
    const y = element.y ?? 0;
    const w = element.width ?? 0;
    const h = element.height ?? 0;
    const entry: SpatialEntry = { element, rect: { x, y, width: w, height: h } };

    const minCX = Math.floor(x * this.invCellW);
    const maxCX = Math.floor((x + w) * this.invCellW);
    const minCY = Math.floor(y * this.invCellH);
    const maxCY = Math.floor((y + h) * this.invCellH);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const k = this.key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) {
          cell = [];
          this.cells.set(k, cell);
        }
        cell.push(entry);
      }
    }
  }

  /**
   * Return candidate elements whose bounding box could overlap the given rect.
   *
   * The result is de-duplicated and does NOT include `excludeId`.
   */
  getCandidates(rect: Rect, excludeId?: string): SpatialEntry[] {
    const { x, y, width: w, height: h } = rect;
    const seen = new Set<string>();
    const result: SpatialEntry[] = [];

    const minCX = Math.floor(x * this.invCellW);
    const maxCX = Math.floor((x + w) * this.invCellW);
    const minCY = Math.floor(y * this.invCellH);
    const maxCY = Math.floor((y + h) * this.invCellH);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (!cell) continue;
        for (const entry of cell) {
          const id = entry.element.id;
          if (seen.has(id)) continue;
          if (excludeId && id === excludeId) continue;
          seen.add(id);
          result.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Return candidates within the given rect expanded by `margin` pixels on
   * each side — useful for proximity checks (not just overlap).
   */
  getCandidatesExpanded(rect: Rect, margin: number, excludeId?: string): SpatialEntry[] {
    return this.getCandidates(
      {
        x: rect.x - margin,
        y: rect.y - margin,
        width: rect.width + margin * 2,
        height: rect.height + margin * 2,
      },
      excludeId
    );
  }

  /** Update an element's position in the index (remove + re-add). */
  update(element: BpmnElement): void {
    this.remove(element.id);
    this.add(element);
  }

  /** Remove an element from the index by ID. */
  remove(id: string): void {
    for (const [key, cell] of this.cells) {
      const filtered = cell.filter((e) => e.element.id !== id);
      if (filtered.length !== cell.length) {
        if (filtered.length === 0) {
          this.cells.delete(key);
        } else {
          this.cells.set(key, filtered);
        }
      }
    }
  }
}

// ── Point-in-segment helper ──────────────────────────────────────────────────

/**
 * Build a SpatialGrid for obstacle shapes, used by element-avoidance
 * to query which shapes a connection segment might pass through.
 *
 * H3: replaces the O(n) per-segment linear scan over all obstacle shapes
 * with an O(k) grid-cell lookup where k is the number of nearby shapes.
 */
export function buildObstacleGrid(shapes: BpmnElement[], cellSize = 200): SpatialGrid {
  const grid = new SpatialGrid(cellSize, cellSize);
  for (const shape of shapes) {
    grid.add(shape);
  }
  return grid;
}

/**
 * Return the axis-aligned bounding box of a line segment, optionally
 * expanded by a margin on all sides.
 */
export function segmentBBox(p1: Point, p2: Point, margin = 0): Rect {
  const minX = Math.min(p1.x, p2.x) - margin;
  const minY = Math.min(p1.y, p2.y) - margin;
  const maxX = Math.max(p1.x, p2.x) + margin;
  const maxY = Math.max(p1.y, p2.y) + margin;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
