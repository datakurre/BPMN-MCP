/**
 * Apply ELK-computed positions and sizes to bpmn-js elements.
 */

import type { ElkNode } from 'elkjs';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/**
 * Recursively apply ELK layout results to bpmn-js elements.
 *
 * For top-level nodes, positions are absolute (parentAbsX/Y is the origin
 * offset).  For children of compound nodes, ELK positions are relative to
 * the parent, so we accumulate offsets as we recurse.
 */
export function applyElkPositions(
  elementRegistry: any,
  modeling: any,
  elkNode: ElkNode,
  parentAbsX: number,
  parentAbsY: number
): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    if (child.x === undefined || child.y === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredX = Math.round(parentAbsX + child.x);
    const desiredY = Math.round(parentAbsY + child.y);
    const dx = desiredX - element.x;
    const dy = desiredY - element.y;

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      modeling.moveElements([element], { x: dx, y: dy });
    }

    // Recurse for compound nodes (participants, expanded subprocesses)
    if (child.children && child.children.length > 0) {
      const updated = elementRegistry.get(child.id);
      if (updated) {
        applyElkPositions(elementRegistry, modeling, child, updated.x, updated.y);
      }
    }
  }
}

/**
 * Resize compound nodes (participants, expanded subprocesses) to match
 * ELK-computed dimensions.
 *
 * ELK computes proper width/height for compound children based on their
 * contents + padding.  `applyElkPositions` only applies x/y, so this
 * separate pass applies the size.  Must run AFTER applyElkPositions so
 * that the element's current x/y is already correct.
 */
export function resizeCompoundNodes(elementRegistry: any, modeling: any, elkNode: ElkNode): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    // Only resize compound nodes (those with children in the ELK result)
    if (!child.children || child.children.length === 0) continue;
    if (child.width === undefined || child.height === undefined) continue;

    const element = elementRegistry.get(child.id);
    if (!element) continue;

    const desiredW = Math.round(child.width);
    const desiredH = Math.round(child.height);

    // Only resize if significantly different from current size
    if (Math.abs(element.width - desiredW) > 5 || Math.abs(element.height - desiredH) > 5) {
      modeling.resizeShape(element, {
        x: element.x,
        y: element.y,
        width: desiredW,
        height: desiredH,
      });
    }

    // Recurse for nested compound nodes (expanded subprocesses inside participants)
    resizeCompoundNodes(elementRegistry, modeling, child);
  }
}

/**
 * Centre elements vertically within each participant pool.
 *
 * After ELK layout + grid snap, the content inside a pool may not be
 * vertically centred — e.g. elements cluster towards the top due to
 * ELK's top-aligned padding.  This pass computes the vertical extent
 * of all flow elements inside each participant and shifts them to be
 * centred within the pool's usable area.
 *
 * Only applies when the vertical offset exceeds a minimum threshold
 * to avoid unnecessary micro-adjustments.
 */
export function centreElementsInPools(elementRegistry: any, modeling: any): void {
  const participants = elementRegistry.filter((el: any) => el.type === 'bpmn:Participant');
  if (participants.length === 0) return;

  for (const pool of participants) {
    // Collect flow elements that are direct children of this pool
    // (skip lanes, connections, boundary events, labels, infrastructure)
    const children = elementRegistry.filter(
      (el: any) =>
        el.parent === pool &&
        !isConnection(el.type) &&
        !isInfrastructure(el.type) &&
        !isArtifact(el.type) &&
        !isLane(el.type) &&
        el.type !== 'bpmn:BoundaryEvent' &&
        el.type !== 'label'
    );

    if (children.length === 0) continue;

    // Compute the vertical bounding box of the children
    let contentMinY = Infinity;
    let contentMaxY = -Infinity;
    for (const child of children) {
      if (child.y < contentMinY) contentMinY = child.y;
      const bottom = child.y + (child.height || 0);
      if (bottom > contentMaxY) contentMaxY = bottom;
    }

    const contentHeight = contentMaxY - contentMinY;

    // Pool usable area (exclude the ~30px left label band)
    const poolTop = pool.y;
    const poolBottom = pool.y + pool.height;
    const usableHeight = poolBottom - poolTop;

    // Desired Y for the content to be centred
    const desiredMinY = poolTop + (usableHeight - contentHeight) / 2;
    const dy = Math.round(desiredMinY - contentMinY);

    // Only shift if the offset is significant (>5px)
    if (Math.abs(dy) > 5) {
      modeling.moveElements(children, { x: 0, y: dy });
    }
  }
}
