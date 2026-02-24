/**
 * Layout helpers: displacement stats, DI deduplication, and grid snapping.
 *
 * DI integrity checks and repair are in layout-di-repair.ts.
 * Container sizing detection and quality metrics are in layout-quality-metrics.ts.
 */

import { getVisibleElements, getService } from '../helpers';
import { getDefinitionsFromModeler } from '../../linter';
export { checkDiIntegrity, repairMissingDiShapes } from './layout-di-repair';

// ── Pixel grid snapping ────────────────────────────────────────────────────

/** Snap intermediate waypoints of all connections to a pixel grid. */
function snapWaypointsToPixelGrid(elementRegistry: any, modeling: any, quantum: number): void {
  const connections = elementRegistry.filter(
    (el: any) =>
      (el.type?.includes('SequenceFlow') ||
        el.type?.includes('MessageFlow') ||
        el.type?.includes('Association')) &&
      !!el.waypoints &&
      el.waypoints.length >= 2
  );
  for (const conn of connections) {
    const wps = conn.waypoints!;
    const snapped = wps.map((wp: any, i: number) => {
      // Preserve endpoints — they must stay on shape boundaries
      if (i === 0 || i === wps.length - 1) return { x: wp.x, y: wp.y };
      return {
        x: Math.round(wp.x / quantum) * quantum,
        y: Math.round(wp.y / quantum) * quantum,
      };
    });
    const changed = snapped.some((wp: any, i: number) => wp.x !== wps[i].x || wp.y !== wps[i].y);
    if (changed) {
      modeling.updateWaypoints(conn, snapped);
    }
  }
}

/**
 * Apply pixel-level grid snapping to all shapes and connection waypoints.
 *
 * Snaps shape x/y positions and intermediate waypoints to the nearest
 * multiple of `pixelGridSnap` (e.g. 10 for bpmn-js's 10px interactive
 * grid).  Boundary events are excluded from shape snapping since they
 * must stay on their host boundary.  Connection endpoints (first/last
 * waypoint) are excluded from waypoint snapping to keep them on shape
 * boundaries.
 */
export function applyPixelGridSnap(diagram: any, pixelGridSnap: number): void {
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const visibleElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:BoundaryEvent'
  );
  for (const el of visibleElements) {
    const snappedX = Math.round(el.x / pixelGridSnap) * pixelGridSnap;
    const snappedY = Math.round(el.y / pixelGridSnap) * pixelGridSnap;
    if (snappedX !== el.x || snappedY !== el.y) {
      modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
    }
  }
  // D3-2: Also snap intermediate connection waypoints.
  snapWaypointsToPixelGrid(elementRegistry, modeling, pixelGridSnap);
}

// ── Displacement stats for dry-run ─────────────────────────────────────────

export interface DisplacementStats {
  movedCount: number;
  maxDisplacement: number;
  avgDisplacement: number;
  displacements: Array<{ id: string; dx: number; dy: number; distance: number }>;
}

/** Compute layout displacement stats between original and laid-out element positions. */
export function computeDisplacementStats(
  originalPositions: Map<string, { x: number; y: number }>,
  elementRegistry: any
): DisplacementStats {
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  const displacements: Array<{ id: string; dx: number; dy: number; distance: number }> = [];
  let maxDisplacement = 0;
  let totalDisplacement = 0;
  let movedCount = 0;

  for (const el of elements) {
    const orig = originalPositions.get(el.id);
    if (!orig) continue;
    const dx = (el.x ?? 0) - orig.x;
    const dy = (el.y ?? 0) - orig.y;
    const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (distance > 1) {
      movedCount++;
      displacements.push({ id: el.id, dx: Math.round(dx), dy: Math.round(dy), distance });
      if (distance > maxDisplacement) maxDisplacement = distance;
      totalDisplacement += distance;
    }
  }

  return {
    movedCount,
    maxDisplacement,
    avgDisplacement: movedCount > 0 ? Math.round(totalDisplacement / movedCount) : 0,
    displacements: displacements.sort((a, b) => b.distance - a.distance).slice(0, 10),
  };
}

// ── DI deduplication in modeler state ──────────────────────────────────────

/**
 * Remove duplicate BPMNShape/BPMNEdge entries from the modeler's DI plane.
 *
 * When multiple operations create DI entries for the same bpmnElement, the
 * plane's `planeElement` array may contain duplicates.  This function scans
 * the array and removes earlier occurrences, keeping the last (most
 * up-to-date) entry for each referenced element.
 *
 * Returns the number of duplicate entries removed.
 */
export function deduplicateDiInModeler(diagram: any): number {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions?.diagrams?.[0]?.plane?.planeElement) return 0;

    const plane = definitions.diagrams[0].plane!;
    const elements: any[] = plane.planeElement!;

    // Map bpmnElement.id → last index
    const lastIndex = new Map<string, number>();
    for (let i = 0; i < elements.length; i++) {
      const refId = elements[i].bpmnElement?.id;
      if (refId) lastIndex.set(refId, i);
    }

    // Collect indices of earlier duplicates
    const toRemove: number[] = [];
    const seen = new Set<string>();
    for (let i = elements.length - 1; i >= 0; i--) {
      const refId = elements[i].bpmnElement?.id;
      if (!refId) continue;
      if (seen.has(refId)) {
        toRemove.push(i);
      }
      seen.add(refId);
    }

    if (toRemove.length === 0) return 0;

    // Remove from highest index first to preserve earlier indices
    toRemove.sort((a, b) => b - a);
    for (const idx of toRemove) {
      elements.splice(idx, 1);
    }

    return toRemove.length;
  } catch {
    return 0;
  }
}

/**
 * After autosize, align collapsed partner pools horizontally to match
 * the width and left edge of the expanded (executable) pools.
 */
export function alignCollapsedPoolsAfterAutosize(elementRegistry: any, modeling: any): void {
  const pools = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  if (pools.length < 2) return;

  const expanded: any[] = [];
  const collapsed: any[] = [];
  for (const p of pools) {
    const hasChildren =
      elementRegistry.filter(
        (el: any) =>
          el.parent === p &&
          !el.type.includes('Flow') &&
          !el.type.includes('Lane') &&
          el.type !== 'bpmn:Process' &&
          el.type !== 'label'
      ).length > 0;
    if (hasChildren) expanded.push(p);
    else collapsed.push(p);
  }
  if (expanded.length === 0 || collapsed.length === 0) return;

  let minX = Infinity;
  let maxRight = -Infinity;
  for (const p of expanded) {
    if (p.x < minX) minX = p.x;
    if (p.x + (p.width || 0) > maxRight) maxRight = p.x + (p.width || 0);
  }
  const expandedWidth = maxRight - minX;
  for (const pool of collapsed) {
    const dx = Math.round(minX - pool.x);
    if (Math.abs(dx) > 2) modeling.moveElements([pool], { x: dx, y: 0 });
    const cur = elementRegistry.get(pool.id);
    if (Math.abs((cur.width || 0) - expandedWidth) > 5) {
      modeling.resizeShape(cur, {
        x: cur.x,
        y: cur.y,
        width: expandedWidth,
        height: cur.height || 60,
      });
    }
  }
}
