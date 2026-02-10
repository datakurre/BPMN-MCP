/**
 * Post-ELK grid snap pass.
 *
 * Quantises node coordinates to a virtual grid after ELK positioning,
 * combining ELK's optimal topology with bpmn-auto-layout's visual
 * regularity.
 */

import { ELK_LAYER_SPACING, ELK_NODE_SPACING } from '../constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';
import type { GridLayer } from './types';

/**
 * Detect discrete layers (columns) from element x-positions.
 *
 * After ELK positioning and snapSameLayerElements(), elements in the
 * same ELK layer share approximately the same x-centre.  This function
 * groups them into discrete layers by clustering x-centres.
 *
 * Only considers direct children of the given container (or the root
 * process when no container is given).  This prevents mixing elements
 * from different nesting levels (e.g. subprocess internals with top-level
 * elements), which would cause cascading moves via modeling.moveElements.
 */
export function detectLayers(elementRegistry: any, container?: any): GridLayer[] {
  // When no container is specified, find the root process element so we
  // only include its direct children — not children of subprocesses.
  let parentFilter: any = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  // If no root found (shouldn't happen), fall back to including all elements
  if (!parentFilter) {
    const shapes = elementRegistry.filter(
      (el: any) =>
        !isInfrastructure(el.type) &&
        !isConnection(el.type) &&
        !isArtifact(el.type) &&
        !isLane(el.type) &&
        el.type !== 'bpmn:BoundaryEvent' &&
        el.type !== 'label' &&
        el.type !== 'bpmn:Participant'
    );
    return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
  }

  const shapes = elementRegistry.filter(
    (el: any) =>
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label' &&
      el.type !== 'bpmn:Participant' &&
      el.parent === parentFilter
  );

  return shapes.length === 0 ? [] : clusterIntoLayers(shapes);
}

/** Cluster shapes into layers by x-centre proximity. */
function clusterIntoLayers(shapes: any[]): GridLayer[] {
  // Sort by x-centre
  const sorted = [...shapes].sort(
    (a: any, b: any) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2)
  );

  // Cluster into layers: elements within layerThreshold of the first
  // element in the current cluster are in the same layer.
  const layerThreshold = ELK_LAYER_SPACING / 2;
  const layers: GridLayer[] = [];
  let currentGroup: any[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentGroup[0].x + (currentGroup[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;
    if (Math.abs(currCx - prevCx) <= layerThreshold) {
      currentGroup.push(sorted[i]);
    } else {
      layers.push(buildLayer(currentGroup));
      currentGroup = [sorted[i]];
    }
  }
  layers.push(buildLayer(currentGroup));

  return layers;
}

function buildLayer(elements: any[]): GridLayer {
  let minX = Infinity;
  let maxRight = -Infinity;
  let maxWidth = 0;
  for (const el of elements) {
    const x = el.x;
    const right = x + (el.width || 0);
    const w = el.width || 0;
    if (x < minX) minX = x;
    if (right > maxRight) maxRight = right;
    if (w > maxWidth) maxWidth = w;
  }
  return { elements, minX, maxRight, maxWidth };
}

/**
 * Classify the dominant element category of a layer.
 *
 * Returns 'event', 'gateway', or 'task' (the default catch-all that
 * includes service tasks, user tasks, subprocesses, etc.).
 */
function dominantCategory(layer: GridLayer): 'event' | 'gateway' | 'task' {
  let events = 0;
  let gateways = 0;
  for (const el of layer.elements) {
    if (el.type?.includes('Event')) events++;
    else if (el.type?.includes('Gateway')) gateways++;
  }
  const total = layer.elements.length;
  if (events > 0 && events >= total / 2) return 'event';
  if (gateways > 0 && gateways >= total / 2) return 'gateway';
  return 'task';
}

/**
 * Compute the horizontal gap between two adjacent layers based on their
 * dominant element types.
 *
 * Uses ELK_LAYER_SPACING as the baseline and applies small adjustments
 * for element type pairs to produce more natural-looking spacing:
 *
 * - **Event → Task / Task → Event**: slightly larger gap because events
 *   are small (36px wide) and need visual breathing room next to larger
 *   task shapes.
 * - **Gateway → Task / Task → Gateway**: standard gap — gateways (50px)
 *   are mid-sized and pair naturally with tasks at the default spacing.
 * - **Gateway → Event / Event → Gateway**: slightly tighter gap — both
 *   are compact shapes that look balanced with less whitespace.
 * - **Task → Task**: standard baseline gap.
 *
 * When the user provides a `layerSpacing` override via the layout tool,
 * that value replaces ELK_LAYER_SPACING everywhere, so the type-aware
 * deltas still apply relative to the override.
 */
function computeInterLayerGap(prevLayer: GridLayer, nextLayer: GridLayer): number {
  const base = ELK_LAYER_SPACING;
  const prevCat = dominantCategory(prevLayer);
  const nextCat = dominantCategory(nextLayer);

  // Event ↔ Task: add breathing room (events are small beside large tasks)
  if ((prevCat === 'event' && nextCat === 'task') || (prevCat === 'task' && nextCat === 'event')) {
    return base + 10;
  }

  // Gateway ↔ Event: tighten (both compact shapes)
  if (
    (prevCat === 'gateway' && nextCat === 'event') ||
    (prevCat === 'event' && nextCat === 'gateway')
  ) {
    return base - 5;
  }

  // All other pairs (task→task, task↔gateway, event→event): baseline
  return base;
}

/**
 * Post-ELK grid snap pass.
 *
 * Steps:
 * 1. Detect discrete layers (columns) from element x-positions.
 * 2. Snap layers to type-aware x-columns with element-aware gaps.
 * 3. Distribute elements uniformly within each layer (vertical).
 * 4. Centre gateways on their connected branches.
 * 5. Preserve happy-path row (pin happy-path elements, distribute others).
 */
export function gridSnapPass(
  elementRegistry: any,
  modeling: any,
  happyPathEdgeIds?: Set<string>,
  container?: any
): void {
  const layers = detectLayers(elementRegistry, container);
  if (layers.length < 2) return;

  // Determine happy-path element IDs from the happy-path edges
  const happyPathNodeIds = new Set<string>();
  if (happyPathEdgeIds && happyPathEdgeIds.size > 0) {
    const allElements: any[] = elementRegistry.getAll();
    for (const el of allElements) {
      if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
        if (el.source) happyPathNodeIds.add(el.source.id);
        if (el.target) happyPathNodeIds.add(el.target.id);
      }
    }
  }

  // ── Step 1: Snap layers to uniform x-columns ──
  // Compute column x-positions: each layer starts at
  // previous_layer_right_edge + type-aware gap.
  let columnX = layers[0].minX; // First layer stays at its current position

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];

    if (i > 0) {
      // Element-type-aware gap between adjacent layers
      const gap = computeInterLayerGap(layers[i - 1], layer);
      columnX = layers[i - 1].maxRight + gap;
    }

    // Centre each element in the column based on the max width
    for (const el of layer.elements) {
      const elW = el.width || 0;
      const desiredX = columnX + (layer.maxWidth - elW) / 2;
      const dx = Math.round(desiredX) - el.x;
      if (Math.abs(dx) > 0.5) {
        modeling.moveElements([el], { x: dx, y: 0 });
      }
    }

    // Update layer bounds after moving
    let newMinX = Infinity;
    let newMaxRight = -Infinity;
    for (const el of layer.elements) {
      const updated = elementRegistry.get(el.id);
      if (updated.x < newMinX) newMinX = updated.x;
      const right = updated.x + (updated.width || 0);
      if (right > newMaxRight) newMaxRight = right;
    }
    layers[i] = { ...layer, minX: newMinX, maxRight: newMaxRight };
  }

  // ── Step 2: Uniform vertical spacing within layers ──
  const nodeSpacing = ELK_NODE_SPACING;

  for (const layer of layers) {
    if (layer.elements.length < 2) continue;

    // Sort by current Y
    const sorted = [...layer.elements].sort((a: any, b: any) => a.y - b.y);

    // Identify happy-path elements in this layer
    const happyEls = sorted.filter((el: any) => happyPathNodeIds.has(el.id));
    const nonHappyEls = sorted.filter((el: any) => !happyPathNodeIds.has(el.id));

    // If there's a happy-path element, pin it and distribute others around it
    if (happyEls.length > 0 && nonHappyEls.length > 0) {
      // Pin the first happy-path element's Y as the reference
      const pinnedY = happyEls[0].y + (happyEls[0].height || 0) / 2;

      // Sort non-happy elements into above and below the pinned element
      const above = nonHappyEls.filter((el: any) => el.y + (el.height || 0) / 2 < pinnedY);
      const below = nonHappyEls.filter((el: any) => el.y + (el.height || 0) / 2 >= pinnedY);

      // Distribute above elements upward from the pinned position
      let nextY = pinnedY - (happyEls[0].height || 0) / 2 - nodeSpacing;
      for (let i = above.length - 1; i >= 0; i--) {
        const el = above[i];
        const elH = el.height || 0;
        const desiredY = nextY - elH;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY - nodeSpacing;
      }

      // Distribute below elements downward from the pinned position
      nextY = pinnedY + (happyEls[0].height || 0) / 2 + nodeSpacing;
      for (const el of below) {
        const desiredY = nextY;
        const dy = Math.round(desiredY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        nextY = desiredY + (el.height || 0) + nodeSpacing;
      }
    } else {
      // No happy path — just distribute uniformly
      // Compute the vertical centre of the group
      const totalHeight = sorted.reduce((sum: number, el: any) => sum + (el.height || 0), 0);
      const totalGaps = (sorted.length - 1) * nodeSpacing;
      const groupHeight = totalHeight + totalGaps;
      const currentCentreY =
        (sorted[0].y + sorted[sorted.length - 1].y + (sorted[sorted.length - 1].height || 0)) / 2;
      let startY = currentCentreY - groupHeight / 2;

      for (const el of sorted) {
        const dy = Math.round(startY) - el.y;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
        startY += (el.height || 0) + nodeSpacing;
      }
    }
  }

  // ── Step 3: Centre gateways on their connected branches ──
  // Skip gateways that are on the happy path to preserve straightness.
  centreGatewaysOnBranches(elementRegistry, modeling, happyPathNodeIds);

  // ── Step 4: Symmetrise gateway branches ──
  // For split gateways on the happy path, ensure off-path branches
  // are placed symmetrically above/below the happy-path centre line.
  symmetriseGatewayBranches(elementRegistry, modeling, happyPathNodeIds);

  // ── Step 5: Align boundary sub-flow end events ──
  // End events reachable from boundary event flows should align with
  // their immediate predecessor's Y to form clean visual rows.
  alignBoundarySubFlowEndEvents(elementRegistry, modeling);
}

/**
 * After grid snapping, re-centre gateways vertically to the midpoint
 * of their connected elements.  This matches bpmn-auto-layout's behaviour
 * where split/join gateways sit at the visual centre of their branches.
 *
 * Skips gateways on the happy path to avoid breaking row alignment.
 */
function centreGatewaysOnBranches(
  elementRegistry: any,
  modeling: any,
  happyPathNodeIds: Set<string>
): void {
  const gateways = elementRegistry.filter((el: any) => el.type?.includes('Gateway'));

  for (const gw of gateways) {
    // Skip gateways on the happy path to preserve row alignment
    if (happyPathNodeIds.has(gw.id)) continue;

    // Collect all directly connected elements (via outgoing + incoming flows)
    const connectedYs: number[] = [];
    const allElements: any[] = elementRegistry.getAll();

    for (const el of allElements) {
      if (!isConnection(el.type)) continue;
      if (el.source?.id === gw.id && el.target) {
        connectedYs.push(el.target.y + (el.target.height || 0) / 2);
      }
      if (el.target?.id === gw.id && el.source) {
        connectedYs.push(el.source.y + (el.source.height || 0) / 2);
      }
    }

    if (connectedYs.length < 2) continue;

    const minY = Math.min(...connectedYs);
    const maxY = Math.max(...connectedYs);
    const midY = (minY + maxY) / 2;
    const gwCy = gw.y + (gw.height || 0) / 2;

    const dy = Math.round(midY - gwCy);
    if (Math.abs(dy) > 2) {
      modeling.moveElements([gw], { x: 0, y: dy });
    }
  }
}

/**
 * Symmetrise gateway branches around the happy-path centre line.
 *
 * For split gateways on the happy path with exactly 2 branch targets
 * in the same layer (both tasks, one happy-path and one off-path),
 * redistributes them symmetrically around the gateway's centre Y.
 *
 * Also handles off-path end events: positions them at the same Y as
 * their incoming branch element to avoid long vertical connectors
 * that make them appear disconnected.
 */
function symmetriseGatewayBranches(
  elementRegistry: any,
  modeling: any,
  happyPathNodeIds: Set<string>
): void {
  const allElements: any[] = elementRegistry.getAll();
  const nodeSpacing = ELK_NODE_SPACING;

  // Find split gateways on the happy path (≥2 outgoing flows)
  const splitGateways = allElements.filter((el: any) => {
    if (!el.type?.includes('Gateway')) return false;
    if (!happyPathNodeIds.has(el.id)) return false;
    const outCount = allElements.filter(
      (conn: any) => isConnection(conn.type) && conn.source?.id === el.id
    ).length;
    return outCount >= 2;
  });

  for (const gw of splitGateways) {
    const gwCy = gw.y + (gw.height || 0) / 2;

    // Find outgoing connections and their non-gateway, non-event targets
    // (i.e. the branch task targets, excluding merge gateways / end events)
    const outgoing = allElements.filter(
      (conn: any) => isConnection(conn.type) && conn.source?.id === gw.id && conn.target
    );

    // Collect ALL branch targets (both on-path and off-path)
    const branchTargets = outgoing
      .map((conn: any) => conn.target)
      .filter((t: any) => t.type !== 'bpmn:EndEvent' && !t.type?.includes('Gateway'));

    // For 2-branch patterns with tasks, symmetrise both around the gateway Y
    if (branchTargets.length === 2) {
      const [t1, t2] = branchTargets;
      const t1Cy = t1.y + (t1.height || 0) / 2;
      const t2Cy = t2.y + (t2.height || 0) / 2;

      // Check if the two targets are roughly in the same layer (similar X)
      const t1Cx = t1.x + (t1.width || 0) / 2;
      const t2Cx = t2.x + (t2.width || 0) / 2;
      if (Math.abs(t1Cx - t2Cx) > 50) continue; // Different layers, skip

      // Ideal: both equidistant from gateway centre
      const totalSpan = Math.abs(t1Cy - t2Cy);
      const idealSpan = Math.max(totalSpan, nodeSpacing + Math.max(t1.height || 0, t2.height || 0));
      const halfSpan = idealSpan / 2;

      // Sort by current Y to determine which goes above/below
      const [upper, lower] = t1Cy < t2Cy ? [t1, t2] : [t2, t1];

      const upperDesiredCy = gwCy - halfSpan;
      const lowerDesiredCy = gwCy + halfSpan;

      const upperCy = upper.y + (upper.height || 0) / 2;
      const lowerCy = lower.y + (lower.height || 0) / 2;

      const dyUpper = Math.round(upperDesiredCy - upperCy);
      const dyLower = Math.round(lowerDesiredCy - lowerCy);

      if (Math.abs(dyUpper) > 2) {
        modeling.moveElements([upper], { x: 0, y: dyUpper });
      }
      if (Math.abs(dyLower) > 2) {
        modeling.moveElements([lower], { x: 0, y: dyLower });
      }
    }

    // ── Off-path target handling ──
    const offPathTargets = outgoing
      .map((conn: any) => conn.target)
      .filter((t: any) => !happyPathNodeIds.has(t.id));

    // Move off-path end events to the same Y as their immediate
    // predecessor to avoid long vertical connectors.
    for (const target of offPathTargets) {
      if (target.type !== 'bpmn:EndEvent') continue;

      // Find incoming connection to this end event
      const incoming = allElements.find(
        (conn: any) => isConnection(conn.type) && conn.target?.id === target.id && conn.source
      );
      if (!incoming) continue;

      const sourceCy = incoming.source.y + (incoming.source.height || 0) / 2;
      const targetCy = target.y + (target.height || 0) / 2;
      const dy = Math.round(sourceCy - targetCy);
      if (Math.abs(dy) > 2) {
        modeling.moveElements([target], { x: 0, y: dy });
      }
    }
  }
}

/**
 * Align end events that are reachable from boundary event flows.
 *
 * Boundary events spawn exception sub-flows that often end with an
 * EndEvent.  Without explicit alignment, these end events can float
 * between the happy path and the lower branch instead of forming a
 * clean visual row.
 *
 * For each end event not already aligned with its predecessor,
 * snaps it to the Y-centre of the element that feeds into it.
 * This matches the pattern that `symmetriseGatewayBranches()` uses
 * for gateway-connected end events.
 */
function alignBoundarySubFlowEndEvents(elementRegistry: any, modeling: any): void {
  const allElements: any[] = elementRegistry.getAll();

  // Find boundary events with outgoing flows
  const boundaryEvents = allElements.filter(
    (el: any) => el.type === 'bpmn:BoundaryEvent' && el.outgoing?.length > 0
  );

  for (const be of boundaryEvents) {
    // Trace forward from the boundary event, following outgoing flows
    // until we find end events
    const visited = new Set<string>();
    const queue: any[] = [be];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      // Find outgoing connections from this element
      const outgoing = allElements.filter(
        (conn: any) => isConnection(conn.type) && conn.source?.id === current.id && conn.target
      );

      for (const conn of outgoing) {
        const target = conn.target;
        if (!target) continue;

        if (target.type === 'bpmn:EndEvent') {
          // Align the end event's Y-centre with its incoming source's Y-centre
          const sourceCy = current.y + (current.height || 0) / 2;
          const targetCy = target.y + (target.height || 0) / 2;
          const dy = Math.round(sourceCy - targetCy);
          if (Math.abs(dy) > 2) {
            modeling.moveElements([target], { x: 0, y: dy });
          }
        } else if (!visited.has(target.id)) {
          // Continue tracing through intermediate elements
          queue.push(target);
        }
      }
    }
  }
}

/**
 * Align all happy-path elements to a single Y-centre.
 *
 * After gridSnapPass, elements on the detected happy path may have small
 * Y-centre offsets (5–15 px) caused by ELK's gateway port placement and
 * node-size rounding.  This pass computes the median Y-centre of all
 * happy-path elements and snaps them to it, producing a perfectly
 * straight main flow line.
 *
 * Only corrects small wobbles (≤ MAX_WOBBLE_CORRECTION px).  Elements
 * that are far from the median are likely on separate branches of a
 * split/join pattern and should NOT be moved.
 *
 * Must run AFTER gridSnapPass (which may introduce the wobble) and
 * BEFORE edge routing (so waypoints reflect final positions).
 */
export function alignHappyPath(
  elementRegistry: any,
  modeling: any,
  happyPathEdgeIds?: Set<string>,
  container?: any
): void {
  if (!happyPathEdgeIds || happyPathEdgeIds.size === 0) return;

  /** Maximum Y-centre correction (px) to apply.  Larger deviations
   *  indicate the element is on a different branch, not a wobble. */
  const MAX_WOBBLE_CORRECTION = 20;

  // Determine which container to scope to
  let parentFilter: any = container;
  if (!parentFilter) {
    parentFilter = elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  }

  // Collect happy-path node IDs from the edge set
  const happyPathNodeIds = new Set<string>();
  const allElements: any[] = elementRegistry.getAll();
  for (const el of allElements) {
    if (isConnection(el.type) && happyPathEdgeIds.has(el.id)) {
      if (el.source) happyPathNodeIds.add(el.source.id);
      if (el.target) happyPathNodeIds.add(el.target.id);
    }
  }

  if (happyPathNodeIds.size < 2) return;

  // Get the actual shape objects for happy-path nodes that are direct
  // children of the target container (don't mix nesting levels)
  const happyShapes = allElements.filter(
    (el: any) =>
      happyPathNodeIds.has(el.id) &&
      !isConnection(el.type) &&
      !isInfrastructure(el.type) &&
      !isArtifact(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label' &&
      el.type !== 'bpmn:Participant' &&
      (!parentFilter || el.parent === parentFilter)
  );

  if (happyShapes.length < 2) return;

  // Compute Y-centres
  const yCentres = happyShapes.map((el: any) => el.y + (el.height || 0) / 2);
  yCentres.sort((a: number, b: number) => a - b);

  // Use the median Y-centre as the alignment target
  const medianY = yCentres[Math.floor(yCentres.length / 2)];

  // Snap only happy-path elements that are within MAX_WOBBLE_CORRECTION
  // of the median.  Elements further away are on split/join branches
  // and should keep their gridSnap-assigned Y.
  for (const el of happyShapes) {
    const cy = el.y + (el.height || 0) / 2;
    const dy = Math.round(medianY - cy);
    if (Math.abs(dy) > 0.5 && Math.abs(dy) <= MAX_WOBBLE_CORRECTION) {
      modeling.moveElements([el], { x: 0, y: dy });
    }
  }
}

/**
 * Recursively run gridSnapPass inside expanded subprocesses.
 *
 * Expanded subprocesses are compound nodes whose children are laid out
 * by ELK internally.  The grid snap pass must run separately within each
 * expanded subprocess (scoped to its direct children) to avoid mixing
 * nesting levels.
 */
export function gridSnapExpandedSubprocesses(
  elementRegistry: any,
  modeling: any,
  happyPathEdgeIds?: Set<string>,
  container?: any
): void {
  // Find expanded subprocesses that are direct children of the given container
  const parentFilter =
    container ||
    elementRegistry.filter(
      (el: any) => el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration'
    )[0];
  if (!parentFilter) return;

  const expandedSubs = elementRegistry.filter(
    (el: any) =>
      el.type === 'bpmn:SubProcess' &&
      el.parent === parentFilter &&
      // Only expanded subprocesses (those with layoutable children)
      elementRegistry.filter(
        (child: any) =>
          child.parent === el &&
          !isInfrastructure(child.type) &&
          !isConnection(child.type) &&
          child.type !== 'bpmn:BoundaryEvent'
      ).length > 0
  );

  for (const sub of expandedSubs) {
    gridSnapPass(elementRegistry, modeling, happyPathEdgeIds, sub);
    // Recurse into nested subprocesses
    gridSnapExpandedSubprocesses(elementRegistry, modeling, happyPathEdgeIds, sub);
  }
}
