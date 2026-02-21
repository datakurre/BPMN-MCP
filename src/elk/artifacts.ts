/**
 * Post-layout artifact repositioning.
 *
 * Artifacts (DataObjectReference, DataStoreReference, TextAnnotation) are
 * excluded from the ELK graph.  This module repositions them relative to
 * their associated flow elements after layout.
 */

import {
  ARTIFACT_BELOW_OFFSET,
  ARTIFACT_ABOVE_OFFSET,
  ARTIFACT_BELOW_MIN,
  ARTIFACT_ABOVE_MIN,
  ARTIFACT_PADDING,
  ARTIFACT_NEGATIVE_PADDING,
  ARTIFACT_SEARCH_HEIGHT,
  BPMN_TASK_WIDTH,
  BPMN_DUMMY_HEIGHT,
  CENTER_FACTOR,
  MOVEMENT_THRESHOLD,
} from './constants';
import {
  isConnection as _isConnection,
  isInfrastructure as _isInfrastructure,
  isArtifact,
  isLayoutableShape,
} from './helpers';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

/**
 * Find the flow element linked to an artifact via an association.
 */
function findLinkedFlowElement(
  artifact: BpmnElement,
  associations: BpmnElement[]
): BpmnElement | null {
  for (const assoc of associations) {
    if (assoc.source?.id === artifact.id && assoc.target && !isArtifact(assoc.target.type)) {
      return assoc.target;
    }
    if (assoc.target?.id === artifact.id && assoc.source && !isArtifact(assoc.source.type)) {
      return assoc.source;
    }
  }
  return null;
}

/**
 * Reposition artifact elements relative to their associated flow elements.
 *
 * - TextAnnotations above their linked element (via Association)
 * - DataObjectReference / DataStoreReference below their linked element
 *
 * Handles complex cases:
 * - Multiple artifacts linked to the same element (horizontal spread)
 * - Horizontal overlap between artifacts on different elements
 * - Unlinked artifacts positioned below the flow bounding box
 */

interface FlowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface OccupiedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeFlowBounds(flowElements: BpmnElement[]): FlowBounds {
  let flowMaxY = ARTIFACT_SEARCH_HEIGHT;
  let flowMinY = Infinity;
  let flowMinX = Infinity;
  let flowMaxX = -Infinity;

  for (const el of flowElements) {
    const bottom = el.y + (el.height || 0);
    const right = el.x + (el.width || 0);
    if (bottom > flowMaxY) flowMaxY = bottom;
    if (el.y < flowMinY) flowMinY = el.y;
    if (el.x < flowMinX) flowMinX = el.x;
    if (right > flowMaxX) flowMaxX = right;
  }

  if (flowMinY === Infinity) flowMinY = ARTIFACT_BELOW_MIN;
  if (flowMinX === Infinity) flowMinX = ARTIFACT_ABOVE_MIN;

  return { minX: flowMinX, minY: flowMinY, maxX: flowMaxX, maxY: flowMaxY };
}

function groupArtifactsByLinkedElement(
  artifacts: BpmnElement[],
  associations: BpmnElement[]
): { linked: Map<string, BpmnElement[]>; unlinked: BpmnElement[] } {
  const artifactsByLinkedElement = new Map<string, BpmnElement[]>();
  const unlinkedArtifacts: BpmnElement[] = [];

  for (const artifact of artifacts) {
    const linkedElement = findLinkedFlowElement(artifact, associations);
    if (linkedElement) {
      const group = artifactsByLinkedElement.get(linkedElement.id) || [];
      group.push(artifact);
      artifactsByLinkedElement.set(linkedElement.id, group);
    } else {
      unlinkedArtifacts.push(artifact);
    }
  }

  return { linked: artifactsByLinkedElement, unlinked: unlinkedArtifacts };
}

function resolveOverlap(
  pos: { x: number; y: number },
  w: number,
  h: number,
  isAnnotation: boolean,
  occupiedRects: OccupiedRect[],
  flowMaxX: number
): void {
  for (const rect of occupiedRects) {
    if (
      pos.x < rect.x + rect.w &&
      pos.x + w > rect.x &&
      pos.y < rect.y + rect.h &&
      pos.y + h > rect.y
    ) {
      const rightShift = rect.x + rect.w + ARTIFACT_PADDING;
      const vertShift = isAnnotation
        ? rect.y - h - ARTIFACT_PADDING
        : rect.y + rect.h + ARTIFACT_PADDING;

      if (rightShift + w <= flowMaxX + ARTIFACT_SEARCH_HEIGHT) {
        pos.x = rightShift;
      } else {
        pos.y = vertShift;
      }
    }
  }
}

function moveArtifactIfNeeded(
  artifact: BpmnElement,
  pos: { x: number; y: number },
  modeling: Modeling
): void {
  const dx = pos.x - artifact.x;
  const dy = pos.y - artifact.y;
  if (Math.abs(dx) > MOVEMENT_THRESHOLD || Math.abs(dy) > MOVEMENT_THRESHOLD) {
    modeling.moveElements([artifact], { x: dx, y: dy });
  }
}

function positionLinkedArtifacts(
  artifactsByLinkedElement: Map<string, BpmnElement[]>,
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  occupiedRects: OccupiedRect[],
  flowMaxX: number
): void {
  for (const [linkedId, group] of artifactsByLinkedElement) {
    const linkedElement = elementRegistry.get(linkedId);
    if (!linkedElement) continue;

    const linkCx = linkedElement.x + (linkedElement.width || 0) * CENTER_FACTOR;
    const totalWidth = group.reduce(
      (sum, a) => sum + (a.width || BPMN_TASK_WIDTH) + ARTIFACT_PADDING,
      ARTIFACT_NEGATIVE_PADDING
    );
    let startX = linkCx - totalWidth * CENTER_FACTOR;

    for (const artifact of group) {
      const w = artifact.width || BPMN_TASK_WIDTH;
      const h = artifact.height || BPMN_DUMMY_HEIGHT;
      const isAnnotation = artifact.type === 'bpmn:TextAnnotation';

      const pos = {
        x: startX,
        y: isAnnotation
          ? linkedElement.y - h - ARTIFACT_ABOVE_OFFSET
          : linkedElement.y + (linkedElement.height || 0) + ARTIFACT_BELOW_OFFSET,
      };
      startX += w + ARTIFACT_PADDING;

      resolveOverlap(pos, w, h, isAnnotation, occupiedRects, flowMaxX);
      moveArtifactIfNeeded(artifact, pos, modeling);
      occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    }
  }
}

function positionUnlinkedArtifacts(
  unlinkedArtifacts: BpmnElement[],
  bounds: FlowBounds,
  modeling: Modeling,
  occupiedRects: OccupiedRect[]
): void {
  let unlinkedX = bounds.minX;

  for (const artifact of unlinkedArtifacts) {
    const w = artifact.width || BPMN_TASK_WIDTH;
    const h = artifact.height || BPMN_DUMMY_HEIGHT;
    const isAnnotation = artifact.type === 'bpmn:TextAnnotation';
    const pos = {
      x: unlinkedX,
      y: isAnnotation
        ? bounds.minY - h - ARTIFACT_ABOVE_OFFSET
        : bounds.maxY + ARTIFACT_BELOW_OFFSET,
    };

    // Avoid overlap
    for (const rect of occupiedRects) {
      if (
        pos.x < rect.x + rect.w &&
        pos.x + w > rect.x &&
        pos.y < rect.y + rect.h &&
        pos.y + h > rect.y
      ) {
        pos.y = isAnnotation ? rect.y - h - ARTIFACT_PADDING : rect.y + rect.h + ARTIFACT_PADDING;
      }
    }

    moveArtifactIfNeeded(artifact, pos, modeling);
    occupiedRects.push({ x: pos.x, y: pos.y, w, h });
    unlinkedX += w + ARTIFACT_PADDING;
  }
}

const GROUP_PADDING = 20;

/**
 * Reposition a bpmn:Group to surround its layoutable children.
 * Groups are bounding boxes, not icons — placing them below the flow is wrong.
 * If the group has children that were repositioned by ELK, resize to surround
 * them. If no layoutable children, return false so the caller can apply a
 * position clamp.
 * Returns true if the group was repositioned.
 */
function repositionGroup(
  group: BpmnElement,
  modeling: Modeling,
  elementRegistry?: ElementRegistry
): boolean {
  // First try direct shape children (elements placed inside the group container).
  let children: BpmnElement[] = ((group as any).children ?? []).filter((el: BpmnElement) =>
    isLayoutableShape(el)
  );

  // If no direct children, look for elements whose businessObject.categoryValueRef
  // matches the group's categoryValueRef.  bpmn:Group scope is defined in the
  // BPMN semantic model via categoryValueRef, not via direct parent/child containment,
  // so elements can "belong" to a group without being its DOM children.
  if (children.length === 0 && elementRegistry) {
    const groupCatRef = (group.businessObject as any)?.categoryValueRef;
    if (groupCatRef) {
      children = elementRegistry.filter((el: BpmnElement) => {
        const elCatRef = (el.businessObject as any)?.categoryValueRef;
        return elCatRef === groupCatRef && isLayoutableShape(el);
      });
    }
  }

  if (children.length === 0) return false;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const child of children) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    const w = child.width ?? 0;
    const h = child.height ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  const newX = minX - GROUP_PADDING;
  const newY = minY - GROUP_PADDING;
  const newW = maxX - minX + 2 * GROUP_PADDING;
  const newH = maxY - minY + 2 * GROUP_PADDING;
  modeling.resizeShape(group, { x: newX, y: newY, width: newW, height: newH });
  return true;
}

/**
 * Clamp a childless bpmn:Group into the visible flow bounds when it has been
 * placed at negative coordinates or far outside the diagram.
 *
 * Groups without direct shape children (created standalone, not by
 * dragging elements inside) often land at the default add-element
 * position which may be well outside the main flow bounding box.
 * Rather than leaving them invisible (negative Y) or off-screen,
 * centre them on the flow bounding box so they are at least visible
 * and can be manually repositioned.
 */
function clampGroupToFlowBounds(group: BpmnElement, bounds: FlowBounds, modeling: Modeling): void {
  const gx = group.x ?? 0;
  const gy = group.y ?? 0;
  const gw = group.width ?? 200;
  const gh = group.height ?? 100;

  // Check if the group is outside or overlapping badly with the flow bounds
  const isOutside = gy < 0 || gx < 0 || gy > bounds.maxY + 200 || gx > bounds.maxX + 200;
  if (!isOutside) return;

  // Place the group centred on the flow bounding box
  const flowCx = (bounds.minX + bounds.maxX) / 2;
  const flowCy = (bounds.minY + bounds.maxY) / 2;
  const newX = Math.max(bounds.minX, flowCx - gw / 2);
  const newY = Math.max(bounds.minY, flowCy - gh / 2);

  const dx = Math.round(newX - gx);
  const dy = Math.round(newY - gy);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    try {
      modeling.moveElements([group], { x: dx, y: dy });
    } catch {
      // Non-fatal: group stays at original position
    }
  }
}

export function repositionArtifacts(elementRegistry: ElementRegistry, modeling: Modeling): void {
  const allArtifacts = elementRegistry.filter((el) => isArtifact(el.type));
  if (allArtifacts.length === 0) return;

  // Compute flow bounds FIRST so they are available for childless-group clamping.
  const flowElements = elementRegistry.filter((el) => !!el.type && isLayoutableShape(el));
  const bounds = computeFlowBounds(flowElements);

  // Handle bpmn:Group elements separately:
  //   - Groups with children → resize to surround them (repositionGroup)
  //   - Groups without children → clamp to flow bounds if outside visible area
  // Groups are bounding boxes, not icons, so standard below/above placement is wrong.
  const artifacts = allArtifacts.filter((el) => {
    if (el.type !== 'bpmn:Group') return true;
    const repositioned = repositionGroup(el, modeling, elementRegistry);
    if (!repositioned) {
      // No direct children — clamp to flow bounds so the group is at least visible
      clampGroupToFlowBounds(el, bounds, modeling);
    }
    return false; // Always exclude groups from the icon-artifact pipeline
  });
  if (artifacts.length === 0) return;

  const associations = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:Association' ||
      el.type === 'bpmn:DataInputAssociation' ||
      el.type === 'bpmn:DataOutputAssociation'
  );

  const { linked, unlinked } = groupArtifactsByLinkedElement(artifacts, associations);
  const occupiedRects: OccupiedRect[] = [];

  positionLinkedArtifacts(linked, elementRegistry, modeling, occupiedRects, bounds.maxX);
  positionUnlinkedArtifacts(unlinked, bounds, modeling, occupiedRects);
}
