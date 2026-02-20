/**
 * Core ELK edge section → bpmn-js waypoint conversion.
 *
 * Applies ELK's computed orthogonal edge routes as bpmn-js waypoints,
 * with fallback routing for connections ELK didn't handle.
 */

import type { ElkNode, ElkEdgeSection } from 'elkjs';
import type { ElementRegistry, Modeling } from '../bpmn-types';
import { isConnection } from './helpers';
import { deduplicateWaypoints } from './edge-routing-helpers';
import {
  ENDPOINT_SNAP_TOLERANCE,
  BPMN_EVENT_SIZE,
  SEGMENT_ORTHO_SNAP,
  SELF_LOOP_MARGIN_H,
  SELF_LOOP_MARGIN_V,
} from './constants';

// ── E2: Parallel message flow spacing constants ─────────────────────────────

/**
 * Maximum horizontal distance (px) between two message flow source X
 * coordinates for them to be considered "parallel" and eligible for spacing.
 */
const MSG_FLOW_PARALLEL_THRESHOLD = 40;

/**
 * Vertical offset (px) between parallel message flow horizontal segments.
 * Each flow in a parallel group gets an offset of i * MSG_FLOW_PARALLEL_OFFSET
 * from the group's common midY, producing evenly-spaced horizontal segments.
 */
const MSG_FLOW_PARALLEL_OFFSET = 18;

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
  const edges = elkNode.edges;
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
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  elkResult: ElkNode,
  offsetX: number,
  offsetY: number
): void {
  const BPMN_BOUNDARY_EVENT = 'bpmn:BoundaryEvent';
  const edgeLookup = collectElkEdges(elkResult, offsetX, offsetY);

  const allConnections = elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.source && !!el.target
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
        if (Math.abs(curr.y - prev.y) < SEGMENT_ORTHO_SNAP) {
          curr.y = prev.y;
        }
        if (Math.abs(curr.x - prev.x) < SEGMENT_ORTHO_SNAP) {
          curr.x = prev.x;
        }
      }

      // Deduplicate consecutive identical waypoints (e.g. redundant bend points)
      const deduped = deduplicateWaypoints(waypoints, 0);

      // Snap endpoints to actual element boundaries.
      // Grid snap (step 5) may have moved elements after ELK computed the
      // edge routes, leaving small gaps (~10 px) between waypoints and
      // element borders.  Correct by adjusting the first/last waypoints
      // to touch the current element boundaries.
      // Only snaps straight horizontal flows (2 waypoints, same Y) to
      // avoid disturbing Z/L-shaped routes from gateways.
      const src = conn.source!;
      const tgt = conn.target!;
      if (deduped.length === 2) {
        const srcCy = Math.round(src.y + (src.height || 0) / 2);
        const srcRight = src.x + (src.width || 0);
        const tgtCy = Math.round(tgt.y + (tgt.height || 0) / 2);
        const tgtLeft = tgt.x;

        // Both waypoints on roughly the same Y = horizontal flow
        if (
          Math.abs(deduped[0].y - deduped[1].y) <= ENDPOINT_SNAP_TOLERANCE &&
          Math.abs(deduped[0].y - srcCy) <= ENDPOINT_SNAP_TOLERANCE &&
          Math.abs(deduped[1].y - tgtCy) <= ENDPOINT_SNAP_TOLERANCE
        ) {
          deduped[0] = { x: Math.round(srcRight), y: srcCy };
          deduped[1] = { x: Math.round(tgtLeft), y: tgtCy };
        }
      }

      // D2: Add `.original` to connection endpoints.
      // bpmn-js's CroppingConnectionDocking uses `.original` to store the
      // pre-cropped ideal endpoint position when it clips connection paths to
      // shape boundaries during interactive editing.  When waypoints are set
      // programmatically (as we do here), bpmn-js does not apply cropping and
      // `.original` is absent.  Setting `.original` equal to the actual
      // waypoint position ensures compatibility with subsequent bpmn-js
      // operations (e.g. when the user moves a connected element after layout):
      // ManhattanLayout and DockingUtil will use the pre-saved original to
      // re-compute the new cropped endpoint, preventing a wrong route being
      // drawn from a stale (undefined) original.
      if (deduped.length >= 2) {
        (deduped[0] as Record<string, unknown>).original = {
          x: deduped[0].x,
          y: deduped[0].y,
        };
        (deduped[deduped.length - 1] as Record<string, unknown>).original = {
          x: deduped[deduped.length - 1].x,
          y: deduped[deduped.length - 1].y,
        };
      }

      modeling.updateWaypoints(conn, deduped);
    } else {
      // Fallback: use bpmn-js built-in connection layout for connections
      // that ELK didn't route (boundary events, cross-container flows).
      // This delegates to bpmn-js ManhattanLayout which produces clean
      // orthogonal paths that respect element boundaries.
      const src = conn.source!;
      const tgt = conn.target!;

      if (src.type === BPMN_BOUNDARY_EVENT || conn.type === 'bpmn:MessageFlow') {
        // For boundary events, build a clean route from the boundary event
        // to the target: go down (or up) from the boundary event border,
        // then horizontally to the target.  bpmn-js ManhattanLayout can
        // produce backward routes in headless mode.
        if (src.type === BPMN_BOUNDARY_EVENT && tgt) {
          const srcCx = src.x + (src.width || BPMN_EVENT_SIZE) / 2;
          const srcBottom = src.y + (src.height || BPMN_EVENT_SIZE);
          const tgtW = tgt.width || BPMN_EVENT_SIZE;
          const tgtCy = tgt.y + (tgt.height || BPMN_EVENT_SIZE) / 2;

          // Enter target from the side facing the source (L-shaped route:
          // vertical from boundary event, then horizontal to target).
          // Use the left edge when the target is to the right of the
          // boundary event, or the right edge when it's to the left.
          const tgtCx = srcCx <= tgt.x + tgtW / 2 ? tgt.x : tgt.x + tgtW;

          // Determine if target is below or above the boundary event
          const goDown = tgtCy >= src.y;
          const startY = goDown ? srcBottom : src.y;

          const waypoints = [
            { x: Math.round(srcCx), y: Math.round(startY) },
            { x: Math.round(srcCx), y: Math.round(tgtCy) },
            { x: Math.round(tgtCx), y: Math.round(tgtCy) },
          ];

          // Deduplicate if source and target are aligned
          const deduped = deduplicateWaypoints(waypoints);

          if (deduped.length >= 2) {
            modeling.updateWaypoints(conn, deduped);
          } else {
            modeling.layoutConnection(conn);
          }
        } else {
          // Message flows — route with clean vertical-horizontal-vertical dog-leg
          // instead of relying on bpmn-js ManhattanLayout which can produce
          // diagonal or sub-optimal routes in headless mode.
          const srcW = src.width || 0;
          const srcH = src.height || 0;
          const tgtW = tgt.width || 0;
          const tgtH = tgt.height || 0;
          const srcCx = Math.round(src.x + srcW / 2);
          const tgtCx = Math.round(tgt.x + tgtW / 2);

          // Determine vertical direction: source is above or below target
          const srcBottom = src.y + srcH;
          const tgtTop = tgt.y;
          const srcTop = src.y;
          const tgtBottom = tgt.y + tgtH;

          if (srcBottom <= tgtTop) {
            // Source is above target — exit from source bottom, enter target top
            const midY = Math.round((srcBottom + tgtTop) / 2);
            const waypoints = [
              { x: srcCx, y: Math.round(srcBottom) },
              { x: srcCx, y: midY },
              { x: tgtCx, y: midY },
              { x: tgtCx, y: Math.round(tgtTop) },
            ];
            const deduped = deduplicateWaypoints(waypoints);
            if (deduped.length >= 2) {
              modeling.updateWaypoints(conn, deduped);
            } else {
              modeling.layoutConnection(conn);
            }
          } else if (tgtBottom <= srcTop) {
            // Target is above source — exit from source top, enter target bottom
            const midY = Math.round((tgtBottom + srcTop) / 2);
            const waypoints = [
              { x: srcCx, y: Math.round(srcTop) },
              { x: srcCx, y: midY },
              { x: tgtCx, y: midY },
              { x: tgtCx, y: Math.round(tgtBottom) },
            ];
            const deduped = deduplicateWaypoints(waypoints);
            if (deduped.length >= 2) {
              modeling.updateWaypoints(conn, deduped);
            } else {
              modeling.layoutConnection(conn);
            }
          } else {
            // Overlapping Y ranges — fall back to bpmn-js routing
            modeling.layoutConnection(conn);
          }
        }
      } else {
        // Generic fallback for other unrouted connections.
        //
        // E3: Associations (bpmn:Association, bpmn:DataInputAssociation,
        // bpmn:DataOutputAssociation) use straight-line routing: a single
        // diagonal segment from source centre to target centre.  BPMN
        // convention renders data and annotation associations as dotted
        // straight lines, not orthogonal bent paths.  The previous
        // orthogonal fallback produced L-shaped routes that looked wrong.
        const srcMid = { x: src.x + (src.width || 0) / 2, y: src.y + (src.height || 0) / 2 };
        const tgtMid = { x: tgt.x + (tgt.width || 0) / 2, y: tgt.y + (tgt.height || 0) / 2 };

        const isAssociation =
          conn.type === 'bpmn:Association' ||
          conn.type === 'bpmn:DataInputAssociation' ||
          conn.type === 'bpmn:DataOutputAssociation';

        if (isAssociation) {
          // Straight-line route: source centre → target centre
          modeling.updateWaypoints(conn, [
            { x: Math.round(srcMid.x), y: Math.round(srcMid.y) },
            { x: Math.round(tgtMid.x), y: Math.round(tgtMid.y) },
          ]);
        } else {
          const waypoints = buildOrthogonalWaypoints(srcMid, tgtMid);

          // Round and deduplicate fallback waypoints
          const rounded = waypoints.map((wp) => ({ x: Math.round(wp.x), y: Math.round(wp.y) }));
          const deduped = deduplicateWaypoints(rounded, 0);
          if (deduped.length >= 2) {
            modeling.updateWaypoints(conn, deduped);
          }
        }
      }
    }
  }
}

/**
 * Route self-loop sequence flows (elements connected to themselves).
 *
 * ELK does not produce edge sections for self-loops.  This function
 * detects connections where source === target and applies a clean
 * rectangular loop path: exit the right side at the upper quarter,
 * extend right, loop below the element, return to the bottom centre.
 *
 * Shape: ─────┐
 *             │
 *        ─────┘
 *
 * Call this after `applyElkEdgeRoutes()` so self-loops are given
 * explicit waypoints before the simplification / repair passes run.
 */
export function routeSelfLoops(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const selfLoops = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:SequenceFlow' && !!el.source && !!el.target && el.source.id === el.target.id
  );

  for (const conn of selfLoops) {
    const el = conn.source!;
    const elW = el.width || 100;
    const elH = el.height || 80;
    const right = el.x + elW;
    const bottom = el.y + elH;
    const cx = Math.round(el.x + elW / 2);

    // Exit the right side at the upper quarter of the element,
    // loop around below, and re-enter at the bottom centre.
    const exitY = Math.round(el.y + elH / 4);
    const loopRight = Math.round(right + SELF_LOOP_MARGIN_H);
    const loopBottom = Math.round(bottom + SELF_LOOP_MARGIN_V);

    const waypoints = [
      { x: Math.round(right), y: exitY }, // exit right side (upper quarter)
      { x: loopRight, y: exitY }, // extend right
      { x: loopRight, y: loopBottom }, // descend below element
      { x: cx, y: loopBottom }, // move left to centre-x
      { x: cx, y: Math.round(bottom) }, // enter bottom centre
    ];

    try {
      modeling.updateWaypoints(conn, waypoints);
    } catch {
      // Skip connections where bpmn-js rejects the waypoints
    }
  }
}
// ── E2: Parallel message flow spacing ──────────────────────────────────────

/**
 * E2: Space parallel message flows that have overlapping horizontal segments.
 *
 * When multiple message flows connect pools at similar horizontal positions,
 * their dog-leg routes share approximately the same midY for the horizontal
 * segment.  This makes parallel flows visually indistinguishable — they appear
 * as a single thick line.
 *
 * This function groups message flows whose source X coordinates are within
 * `MSG_FLOW_PARALLEL_THRESHOLD` pixels of each other and redistributes their
 * horizontal segments to different Y positions, separated by
 * `MSG_FLOW_PARALLEL_OFFSET` pixels per flow.
 *
 * ## Route shape preserved
 * The 4-waypoint dog-leg structure is maintained:
 *   (srcX, srcEdge) → (srcX, newMidY) → (tgtX, newMidY) → (tgtX, tgtEdge)
 * Only the mid-Y is changed; source/target endpoint X positions and element
 * boundary attachment are not affected.
 *
 * ## When to call
 * Call after `applyElkEdgeRoutes()` and `routeSelfLoops()` so that all
 * message flows have their initial dog-leg routes assigned.  Must run before
 * `simplifyCollinearWaypoints()` to avoid collapsing the horizontal segments.
 */
export function spaceParallelMessageFlows(
  elementRegistry: ElementRegistry,
  modeling: Modeling
): void {
  const messageFlows = elementRegistry.filter(
    (el) => el.type === 'bpmn:MessageFlow' && !!el.waypoints && el.waypoints.length >= 3 // dog-leg has ≥3 points
  );

  if (messageFlows.length < 2) return;

  // Group message flows by source-element X centre.
  // Two flows are "parallel" if their source X centres are within threshold.
  // Sort ascending by source X to get a stable group order.
  const flows = messageFlows
    .filter((f) => f.source && f.waypoints)
    .map((f) => ({
      flow: f,
      srcX: f.source!.x + (f.source!.width || 0) / 2,
    }))
    .sort((a, b) => a.srcX - b.srcX);

  if (flows.length < 2) return;

  // Group into clusters where adjacent source X centres are within threshold
  const groups: (typeof flows)[] = [];
  let currentGroup: typeof flows = [flows[0]];
  for (let i = 1; i < flows.length; i++) {
    if (flows[i].srcX - currentGroup[0].srcX <= MSG_FLOW_PARALLEL_THRESHOLD) {
      currentGroup.push(flows[i]);
    } else {
      if (currentGroup.length > 1) groups.push(currentGroup);
      currentGroup = [flows[i]];
    }
  }
  if (currentGroup.length > 1) groups.push(currentGroup);

  // For each group, redistribute the horizontal segment Y positions
  for (const group of groups) {
    const n = group.length;
    if (n < 2) continue;

    // Compute the average midY across all flows in the group
    const midYValues = group
      .map(({ flow }) => {
        const wps = flow.waypoints!;
        // The horizontal segment is the middle portion of the dog-leg.
        // For a 4-waypoint route [start, midStart, midEnd, end],
        // midStart and midEnd share the same Y.  Pick the mean.
        const midPoints = wps.slice(1, wps.length - 1);
        if (midPoints.length === 0) return (wps[0].y + wps[wps.length - 1].y) / 2;
        return midPoints.reduce((sum, wp) => sum + wp.y, 0) / midPoints.length;
      })
      .filter((y) => isFinite(y));

    if (midYValues.length === 0) continue;
    const avgMidY = midYValues.reduce((a, b) => a + b, 0) / midYValues.length;

    // Evenly distribute: flow 0 → avgMidY + (n-1)/2*offset down, last → up
    const totalSpread = (n - 1) * MSG_FLOW_PARALLEL_OFFSET;
    const startMidY = avgMidY - totalSpread / 2;

    for (let i = 0; i < n; i++) {
      const { flow } = group[i];
      const newMidY = Math.round(startMidY + i * MSG_FLOW_PARALLEL_OFFSET);
      const wps = flow.waypoints!;

      if (wps.length < 3) continue;

      // Rebuild dog-leg with new midY, keeping source/target endpoints fixed
      const startWp = wps[0]; // (srcX, srcEdge) — fixed
      const endWp = wps[wps.length - 1]; // (tgtX, tgtEdge) — fixed

      const newWaypoints: Array<{ x: number; y: number }> = [
        { x: startWp.x, y: startWp.y },
        { x: startWp.x, y: newMidY },
        { x: endWp.x, y: newMidY },
        { x: endWp.x, y: endWp.y },
      ];

      // Deduplicate in case source/target X or Y happen to be identical
      const deduped = deduplicateWaypoints(newWaypoints, 0);
      if (deduped.length < 2) continue;

      try {
        modeling.updateWaypoints(flow, deduped);
      } catch {
        // Skip flows where bpmn-js rejects the new waypoints
      }
    }
  }
}
