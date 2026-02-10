/**
 * ELK edge section → bpmn-js waypoint conversion and routing.
 */

import type { ElkNode, ElkExtendedEdge, ElkEdgeSection } from 'elkjs';
import { isConnection } from './helpers';

/**
 * Build a flat lookup of ELK edges (including nested containers) so we can
 * resolve edge sections by connection ID.
 */
function collectElkEdges(
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }> {
  const map = new Map<string, { sections: ElkEdgeSection[]; offsetX: number; offsetY: number }>();

  // Edges at this level
  const edges = (elkNode as any).edges as ElkExtendedEdge[] | undefined;
  if (edges) {
    for (const edge of edges) {
      if (edge.sections && edge.sections.length > 0) {
        map.set(edge.id, { sections: edge.sections, offsetX: parentAbsX, offsetY: parentAbsY });
      }
    }
  }

  // Recurse into children (compound nodes)
  if (elkNode.children) {
    for (const child of elkNode.children) {
      if (child.children && child.children.length > 0) {
        const childAbsX = parentAbsX + (child.x ?? 0);
        const childAbsY = parentAbsY + (child.y ?? 0);
        const nested = collectElkEdges(child, childAbsX, childAbsY);
        for (const [id, val] of nested) {
          map.set(id, val);
        }
      }
    }
  }

  return map;
}

/**
 * Build strictly orthogonal waypoints between two points.
 *
 * If the source and target share the same X or Y (within tolerance),
 * a straight horizontal/vertical segment is used.  Otherwise, an L-shaped
 * route is produced: horizontal first if the primary direction is
 * left-to-right, vertical first otherwise.
 */
function buildOrthogonalWaypoints(
  src: { x: number; y: number },
  tgt: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const dx = Math.abs(tgt.x - src.x);
  const dy = Math.abs(tgt.y - src.y);

  // Nearly aligned — straight segment
  if (dx < 2) {
    return [
      { x: src.x, y: src.y },
      { x: src.x, y: tgt.y },
    ];
  }
  if (dy < 2) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
    ];
  }

  // L-shaped route: go horizontal from src, then vertical to tgt
  if (dx >= dy) {
    return [
      { x: src.x, y: src.y },
      { x: tgt.x, y: src.y },
      { x: tgt.x, y: tgt.y },
    ];
  }

  // Primarily vertical: go vertical first, then horizontal
  return [
    { x: src.x, y: src.y },
    { x: src.x, y: tgt.y },
    { x: tgt.x, y: tgt.y },
  ];
}

/**
 * Apply ELK-computed orthogonal edge routes directly as bpmn-js waypoints.
 *
 * ELK returns edge sections with startPoint, endPoint, and optional
 * bendPoints — all in coordinates relative to the parent container.
 * We convert to absolute diagram coordinates and set them via
 * `modeling.updateWaypoints()` which also updates the BPMN DI.
 *
 * For connections where ELK didn't produce sections (e.g. cross-container
 * message flows), we fall back to `modeling.layoutConnection()`.
 */
export function applyElkEdgeRoutes(
  elementRegistry: any,
  modeling: any,
  elkResult: ElkNode,
  offsetX: number,
  offsetY: number
): void {
  const edgeLookup = collectElkEdges(elkResult, offsetX, offsetY);

  const allConnections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.source && el.target
  );

  for (const conn of allConnections) {
    const elkEdge = edgeLookup.get(conn.id);

    if (elkEdge && elkEdge.sections.length > 0) {
      // Use ELK's computed orthogonal route
      const section = elkEdge.sections[0];
      const ox = elkEdge.offsetX;
      const oy = elkEdge.offsetY;

      const waypoints: Array<{ x: number; y: number }> = [];
      waypoints.push({
        x: Math.round(ox + section.startPoint.x),
        y: Math.round(oy + section.startPoint.y),
      });
      if (section.bendPoints) {
        for (const bp of section.bendPoints) {
          waypoints.push({ x: Math.round(ox + bp.x), y: Math.round(oy + bp.y) });
        }
      }
      waypoints.push({
        x: Math.round(ox + section.endPoint.x),
        y: Math.round(oy + section.endPoint.y),
      });

      // Snap near-horizontal/vertical segments to strict orthogonal.
      // ELK can produce small offsets (up to ~8 px) due to node-size rounding
      // and port placement, so we use a generous tolerance.
      for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1];
        const curr = waypoints[i];
        if (Math.abs(curr.y - prev.y) < 8) {
          curr.y = prev.y;
        }
        if (Math.abs(curr.x - prev.x) < 8) {
          curr.x = prev.x;
        }
      }

      // Deduplicate consecutive identical waypoints (e.g. redundant bend points)
      const deduped = [waypoints[0]];
      for (let i = 1; i < waypoints.length; i++) {
        const prev = deduped[deduped.length - 1];
        if (prev.x !== waypoints[i].x || prev.y !== waypoints[i].y) {
          deduped.push(waypoints[i]);
        }
      }

      modeling.updateWaypoints(conn, deduped);
    } else {
      // Fallback: use bpmn-js built-in connection layout for connections
      // that ELK didn't route (boundary events, cross-container flows).
      // This delegates to bpmn-js ManhattanLayout which produces clean
      // orthogonal paths that respect element boundaries.
      const src = conn.source;
      const tgt = conn.target;

      if (src.type === 'bpmn:BoundaryEvent' || conn.type === 'bpmn:MessageFlow') {
        // Let bpmn-js handle routing for boundary events and message flows
        // — its ManhattanLayout knows about element boundaries and pool gaps.
        modeling.layoutConnection(conn);
      } else {
        // Generic fallback for other unrouted connections
        const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
        const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };
        const waypoints = buildOrthogonalWaypoints(srcMid, tgtMid);

        // Round and deduplicate fallback waypoints
        const rounded = waypoints.map((wp) => ({ x: Math.round(wp.x), y: Math.round(wp.y) }));
        const dedupedFallback = [rounded[0]];
        for (let i = 1; i < rounded.length; i++) {
          const prev = dedupedFallback[dedupedFallback.length - 1];
          if (prev.x !== rounded[i].x || prev.y !== rounded[i].y) {
            dedupedFallback.push(rounded[i]);
          }
        }
        if (dedupedFallback.length >= 2) {
          modeling.updateWaypoints(conn, dedupedFallback);
        }
      }
    }
  }
}
