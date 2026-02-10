/**
 * Apply ELK-computed positions and sizes to bpmn-js elements.
 */

import type { ElkNode } from 'elkjs';

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
