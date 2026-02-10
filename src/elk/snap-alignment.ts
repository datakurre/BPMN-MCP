/**
 * Post-ELK vertical alignment and orthogonal snap passes.
 */

import { ELK_LAYER_SPACING } from '../constants';
import { SAME_ROW_THRESHOLD, ORTHO_SNAP_TOLERANCE } from './constants';
import { isConnection, isInfrastructure, isArtifact } from './helpers';

/**
 * After ELK positions nodes, elements in the same ELK layer can have small
 * Y-centre offsets (5–10 px).  This pass groups elements by their x-position
 * range (same layer) and snaps near-aligned centres to a common Y.
 *
 * Must run BEFORE connection routing so that waypoints are computed from
 * the snapped positions.
 */
export function snapSameLayerElements(elementRegistry: any, modeling: any): void {
  const shapes = elementRegistry.filter(
    (el: any) =>
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      el.type !== 'bpmn:BoundaryEvent' &&
      el.type !== 'label'
  );

  if (shapes.length < 2) return;

  // Group by approximate x-centre (same ELK layer = same x column).
  // Elements within ELK_LAYER_SPACING/2 of each other are in the same layer.
  const layerThreshold = ELK_LAYER_SPACING / 2;
  const sorted = [...shapes].sort(
    (a: any, b: any) => a.x + (a.width || 0) / 2 - (b.x + (b.width || 0) / 2)
  );

  const layers: any[][] = [];
  let currentLayer: any[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevCx = currentLayer[0].x + (currentLayer[0].width || 0) / 2;
    const currCx = sorted[i].x + (sorted[i].width || 0) / 2;
    if (Math.abs(currCx - prevCx) <= layerThreshold) {
      currentLayer.push(sorted[i]);
    } else {
      layers.push(currentLayer);
      currentLayer = [sorted[i]];
    }
  }
  layers.push(currentLayer);

  // Within each layer, find groups of elements whose Y-centres are within
  // SAME_ROW_THRESHOLD — snap them to the median Y-centre.
  for (const layer of layers) {
    if (layer.length < 2) continue;

    const byY = [...layer].sort(
      (a: any, b: any) => a.y + (a.height || 0) / 2 - (b.y + (b.height || 0) / 2)
    );

    // Greedy grouping by Y-centre proximity
    const groups: any[][] = [];
    let group: any[] = [byY[0]];

    for (let i = 1; i < byY.length; i++) {
      const prevCy = group[group.length - 1].y + (group[group.length - 1].height || 0) / 2;
      const currCy = byY[i].y + (byY[i].height || 0) / 2;
      if (Math.abs(currCy - prevCy) <= SAME_ROW_THRESHOLD) {
        group.push(byY[i]);
      } else {
        groups.push(group);
        group = [byY[i]];
      }
    }
    groups.push(group);

    for (const g of groups) {
      if (g.length < 2) continue;

      // Snap to median centre-Y
      const centres = g.map((el: any) => el.y + (el.height || 0) / 2);
      centres.sort((a: number, b: number) => a - b);
      const medianCy = centres[Math.floor(centres.length / 2)];

      for (const el of g) {
        const cy = el.y + (el.height || 0) / 2;
        const dy = medianCy - cy;
        if (Math.abs(dy) > 0.5) {
          modeling.moveElements([el], { x: 0, y: dy });
        }
      }
    }
  }
}

/**
 * Final pass: snap all connection waypoints to strict orthogonal segments.
 *
 * After ELK routing + fallback routing, some segments may have small
 * X or Y offsets (< ORTHO_SNAP_TOLERANCE) that appear diagonal.
 * This pass snaps the smaller delta to zero, making each segment
 * strictly horizontal or vertical.
 *
 * Uses `modeling.updateWaypoints` to record changes on the command stack.
 */
export function snapAllConnectionsOrthogonal(elementRegistry: any, modeling: any): void {
  const allConnections = elementRegistry.filter(
    (el: any) => isConnection(el.type) && el.waypoints && el.waypoints.length >= 2
  );

  for (const conn of allConnections) {
    const wps: Array<{ x: number; y: number }> = conn.waypoints;
    let changed = false;

    // Build snapped copy of waypoints
    const snapped = wps.map((wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y }));

    for (let i = 1; i < snapped.length; i++) {
      const prev = snapped[i - 1];
      const curr = snapped[i];
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);

      // Skip already-orthogonal or truly diagonal segments (both deltas large)
      if (dx < 1 || dy < 1) continue;
      if (dx >= ORTHO_SNAP_TOLERANCE && dy >= ORTHO_SNAP_TOLERANCE) continue;

      // Snap the smaller delta to zero
      if (dx <= dy) {
        curr.x = prev.x;
      } else {
        curr.y = prev.y;
      }
      changed = true;
    }

    if (changed) {
      modeling.updateWaypoints(conn, snapped);
    }
  }
}
