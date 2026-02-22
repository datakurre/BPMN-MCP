/**
 * ELK-based partial (subset) layout for BPMN diagrams.
 *
 * Extracted from `elk/index.ts` to keep the main layout pipeline focused
 * on full-diagram layout.  Handles laying out a specific set of elements
 * while leaving the rest of the diagram untouched.
 */

import type { DiagramState } from '../types';
import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs';

import { isConnection, isInfrastructure, isArtifact } from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import {
  ELK_LAYOUT_OPTIONS,
  START_OFFSET_X,
  START_OFFSET_Y,
  BPMN_TASK_WIDTH,
  BPMN_TASK_HEIGHT,
  BPMN_DUMMY_HEIGHT,
  SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD,
  LOOPBACK_BELOW_MARGIN,
  LOOPBACK_ABOVE_MARGIN,
  LOOPBACK_HORIZONTAL_MARGIN,
} from './constants';
import { buildZShapeRoute } from '../geometry';
import { applyElkPositions } from './position-application';
import { snapSameLayerElements } from './snap-alignment';
import { detectCrossingFlows } from './crossing-detection';
import { resolveOverlaps } from './overlap-resolution';
import { repositionArtifacts } from './artifacts';
import type { ElkLayoutOptions } from './types';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Rebuild routes for edges that connect a subset element to an element
 * outside the subset.
 *
 * After partial layout moves elements within the subset, edges connecting
 * to their external neighbors may have stale waypoints that no longer
 * connect to the element boundaries.  This function detects such "neighbor
 * edges" and rebuilds their routes.
 *
 * For same-row connections (source and target on roughly the same Y within
 * 15px), builds a straight 2-point horizontal route.
 *
 * For different-row forward connections (target to the right of source),
 * builds a Z-shaped route through the midpoint.
 *
 * **C6 — Backward neighbor edges:**
 * For backward connections (target is to the LEFT of source, i.e. a loopback),
 * builds a U-shaped route routing below (or above) the main path.  This
 * mirrors the `routeLoopbacksBelow` approach for the full pipeline and
 * prevents stale waypoints from cutting through the diagram content.
 */
function rebuildNeighborEdges(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  subsetIds: Set<string>
): void {
  const allElements: BpmnElement[] = elementRegistry.getAll();

  // Find connections where exactly one endpoint is in the subset
  const neighborEdges = allElements.filter(
    (el) =>
      isConnection(el.type) &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 2 &&
      subsetIds.has(el.source.id) !== subsetIds.has(el.target.id)
  );

  // Compute the scope bottom/top for backward routing
  // (U-shape routes need to clear all elements in the diagram)
  let scopeBottom = 0;
  let scopeTop = Infinity;
  for (const el of allElements) {
    if (
      isConnection(el.type) ||
      el.type === 'bpmn:BoundaryEvent' ||
      el.type === 'bpmn:Participant' ||
      el.type === 'bpmn:Lane' ||
      el.type === 'label'
    ) {
      continue;
    }
    const bottom = (el.y ?? 0) + (el.height ?? 0);
    if (bottom > scopeBottom) scopeBottom = bottom;
    const top = el.y ?? 0;
    if (top < scopeTop) scopeTop = top;
  }
  if (scopeTop === Infinity) scopeTop = 0;

  for (const conn of neighborEdges) {
    const src = conn.source!;
    const tgt = conn.target!;

    const srcCy = Math.round(src.y + (src.height || 0) / 2);
    const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
    const srcRight = src.x + (src.width || 0);
    const tgtLeft = tgt.x;

    if (tgtLeft > srcRight) {
      const sameRow = Math.abs(srcCy - tgtCy) <= SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD;
      if (sameRow) {
        // Same row: 2-waypoint straight horizontal route — clean and collinear-free.
        modeling.updateWaypoints(conn, [
          { x: Math.round(srcRight), y: srcCy },
          { x: Math.round(tgtLeft), y: srcCy },
        ]);
      } else {
        // D5-3: Cross-row forward edge — delegate to bpmn-js ManhattanLayout.
        // Works headlessly (confirmed via D5-1 spike) and produces routes
        // consistent with Camunda Modeler interactive editing.
        try {
          modeling.layoutConnection(conn);
        } catch {
          // Fallback: manual Z-shape construction.
          modeling.updateWaypoints(conn, buildZShapeRoute(srcRight, srcCy, tgtLeft, tgtCy));
        }
      }
    } else {
      // C6: Backward connection — target is to the LEFT of or overlapping source.
      // Build a U-shaped route that clears all diagram content by routing
      // either below (target at same/lower Y) or above (target higher up).
      const srcCx = Math.round(src.x + (src.width || 0) / 2);
      const srcBottom = src.y + (src.height || 0);
      const tgtCx = Math.round(tgt.x + (tgt.width || 0) / 2);
      const tgtBottom = tgt.y + (tgt.height || 0);

      const routeAbove = tgtCy < srcCy - SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD;

      let newWps: Array<{ x: number; y: number }>;
      if (routeAbove) {
        const aboveY = Math.round(scopeTop - LOOPBACK_ABOVE_MARGIN);
        const exitX = Math.round(srcRight + LOOPBACK_HORIZONTAL_MARGIN);
        const entryX = Math.round(tgtLeft - LOOPBACK_HORIZONTAL_MARGIN);
        if (entryX < exitX) {
          // Wide enough for proper U-shape
          newWps = [
            { x: Math.round(srcRight), y: srcCy },
            { x: exitX, y: srcCy },
            { x: exitX, y: aboveY },
            { x: entryX, y: aboveY },
            { x: entryX, y: tgtCy },
            { x: Math.round(tgtLeft), y: tgtCy },
          ];
        } else {
          // Source and target overlap in X — use centre-X routing (gateway style)
          newWps = [
            { x: srcCx, y: Math.round(src.y) },
            { x: srcCx, y: aboveY },
            { x: tgtCx, y: aboveY },
            { x: tgtCx, y: Math.round(tgtBottom) },
          ];
        }
      } else {
        const belowY = Math.round(scopeBottom + LOOPBACK_BELOW_MARGIN);
        const exitX = Math.round(srcRight + LOOPBACK_HORIZONTAL_MARGIN);
        const entryX = Math.round(tgtLeft - LOOPBACK_HORIZONTAL_MARGIN);
        if (entryX < exitX) {
          // Wide enough for proper U-shape
          newWps = [
            { x: Math.round(srcRight), y: srcCy },
            { x: exitX, y: srcCy },
            { x: exitX, y: belowY },
            { x: entryX, y: belowY },
            { x: entryX, y: tgtCy },
            { x: Math.round(tgtLeft), y: tgtCy },
          ];
        } else {
          // Source and target overlap in X — use centre-X routing (gateway style)
          newWps = [
            { x: srcCx, y: Math.round(srcBottom) },
            { x: srcCx, y: belowY },
            { x: tgtCx, y: belowY },
            { x: tgtCx, y: Math.round(tgt.y) },
          ];
        }
      }
      modeling.updateWaypoints(conn, newWps);
    }
  }
}

// ── Subset layout ───────────────────────────────────────────────────────────

/**
 * Run ELK layered layout on a subset of elements in a BPMN diagram.
 *
 * Builds a sub-graph from the specified element IDs and their
 * inter-connections, runs ELK layout on that sub-graph, and applies
 * positions back — leaving all other elements untouched.
 *
 * Enhancements:
 * - Detects if selected elements share a common participant/subprocess
 *   and uses it as the layout scope (respecting container boundaries).
 * - Includes nearby artifacts (data objects, annotations) linked to
 *   selected elements via associations as pinned (fixed-position) context.
 */

export async function elkLayoutSubset(
  diagram: DiagramState,
  elementIds: string[],
  options?: Omit<ElkLayoutOptions, 'scopeElementId'>
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const idSet = new Set(elementIds);

  // Collect shapes from the element registry
  const shapes: BpmnElement[] = [];
  for (const id of elementIds) {
    const el = elementRegistry.get(id);
    if (el && !isConnection(el.type) && !isInfrastructure(el.type)) {
      shapes.push(el);
    }
  }

  if (shapes.length === 0) return {};

  // Detect if all selected elements share a common container (participant
  // or subprocess).  If so, constrain the layout offset to that container's
  // boundaries so elements don't escape their pool.
  let sharedContainer: BpmnElement | null = null;
  if (shapes.length > 1) {
    const parents = shapes
      .map((s) => s.parent)
      .filter(
        (p): p is BpmnElement =>
          !!p && (p.type === 'bpmn:Participant' || p.type === 'bpmn:SubProcess')
      );
    if (parents.length === shapes.length) {
      const firstParentId = parents[0].id;
      if (parents.every((p) => p.id === firstParentId)) {
        sharedContainer = parents[0];
      }
    }
  }

  // Include artifacts linked to selected elements via associations.
  // These are added as fixed-position nodes so ELK routes around them.
  const allElements: BpmnElement[] = elementRegistry.getAll();
  const associations = allElements.filter(
    (el) =>
      (el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation') &&
      !!el.source &&
      !!el.target
  );

  const linkedArtifactIds = new Set<string>();
  for (const assoc of associations) {
    if (idSet.has(assoc.source!.id) && isArtifact(assoc.target!.type)) {
      linkedArtifactIds.add(assoc.target!.id);
    }
    if (idSet.has(assoc.target!.id) && isArtifact(assoc.source!.type)) {
      linkedArtifactIds.add(assoc.source!.id);
    }
  }

  // Build ELK children nodes
  const children: ElkNode[] = shapes.map((s) => ({
    id: s.id,
    width: s.width || BPMN_TASK_WIDTH,
    height: s.height || BPMN_TASK_HEIGHT,
  }));

  // Add linked artifacts as pinned ELK nodes (fixed position) so the
  // layout respects their presence but doesn't move them.
  for (const artId of linkedArtifactIds) {
    if (idSet.has(artId)) continue; // already in the subset
    const art = elementRegistry.get(artId);
    if (!art) continue;
    children.push({
      id: art.id,
      width: art.width || BPMN_TASK_WIDTH,
      height: art.height || BPMN_DUMMY_HEIGHT,
      layoutOptions: {
        'elk.position': `(${art.x}, ${art.y})`,
        'org.eclipse.elk.noLayout': 'true',
      },
    });
  }
  const edges: ElkExtendedEdge[] = [];
  for (const el of allElements) {
    if (
      isConnection(el.type) &&
      el.source &&
      el.target &&
      idSet.has(el.source.id) &&
      idSet.has(el.target.id)
    ) {
      edges.push({
        id: el.id,
        sources: [el.source.id],
        targets: [el.target.id],
      });
    }
  }

  // Build ELK layout options
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };
  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
  }
  // A3: Enable semiInteractive crossing minimisation for subset layouts.
  // When true, ELK preserves the in-layer positions of pre-placed (pinned)
  // nodes and only optimises the order of unlocked nodes.  In subset layout
  // we have pinned artifact nodes (noLayout: true), so semiInteractive
  // prevents ELK from reordering them, improving position stability when
  // re-laying out a small region of a large diagram.
  layoutOptions['elk.layered.crossingMinimization.semiInteractive'] = 'true';

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };

  const result = await elk.layout(elkGraph);

  // Use the container origin as offset when elements share a container,
  // otherwise use the minimum existing position so elements stay roughly
  // in the same area of the canvas.
  let minX = Infinity;
  let minY = Infinity;
  if (sharedContainer) {
    // Offset inside the container with padding
    minX = sharedContainer.x + START_OFFSET_X;
    minY = sharedContainer.y + START_OFFSET_Y;
  } else {
    for (const s of shapes) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
    }
  }
  const offsetX = minX;
  const offsetY = minY;

  // Apply positions
  applyElkPositions(elementRegistry, modeling, result, offsetX, offsetY);

  // C3: Snap same-layer elements to a common Y before routing.
  // In the full pipeline this runs after applyElkPositions; in subset layout
  // it aligns elements within the subset to clean row positions, preventing
  // small Y-offsets from producing diagonal edge segments.
  snapSameLayerElements(elementRegistry, modeling, sharedContainer ?? undefined);

  // Layout all connections touching the subset using ManhattanLayout.
  // After partial layout moves elements, all connections need proper routing
  // from bpmn-js's built-in orthogonal router.
  const allConnections = elementRegistry.filter(
    (el: BpmnElement) => isConnection(el.type) && !!el.source && !!el.target
  );
  for (const conn of allConnections) {
    // Only re-route connections that touch the subset
    const touchesSubset = idSet.has(conn.source!.id) || idSet.has(conn.target!.id);
    if (touchesSubset) {
      modeling.layoutConnection(conn);
    }
  }

  // Rebuild routes for edges connecting subset elements to their neighbors.
  // After partial layout moves elements, edges to/from elements outside the
  // subset may have stale waypoints that no longer connect properly.
  rebuildNeighborEdges(elementRegistry, modeling, idSet);

  // C3: Resolve overlaps created by the subset layout.
  // After ELK positions and grid alignment, subset elements may overlap
  // with each other or with their neighbors.  This pass pushes overlapping
  // elements apart (same logic as the full pipeline's overlap resolution).
  resolveOverlaps(elementRegistry, modeling, sharedContainer ?? undefined);

  // C3: Reposition artifacts linked to subset elements.
  // Data objects, data stores, and text annotations associated with moved
  // elements need to be re-anchored to their new positions.
  repositionArtifacts(elementRegistry, modeling);

  // Report crossing flows for the laid-out region
  const crossingFlowsResult = detectCrossingFlows(elementRegistry);
  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}
