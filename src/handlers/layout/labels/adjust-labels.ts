/**
 * Post-processing function that adjusts external labels to bpmn-js
 * default positions (matching Camunda Modeler interactive placement).
 *
 * Uses the same formula as bpmn-js `getExternalLabelMid()`:
 * - Events / Gateways / Data objects: label centre below the element
 *   at (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 * - Flows: label at the connection midpoint (placed by bpmn-js after
 *   `modeling.layoutConnection()`)
 *
 * Boundary events with outgoing flows get their label placed to the left
 * to avoid overlapping the downward-exiting flow.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all element labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 * - `centerFlowLabels(diagram)` — centers flow labels on connection midpoints
 * - `adjustFlowLabels(diagram)` — no-op (kept for API compatibility)
 */

import { type DiagramState } from '../../../types';
import type { BpmnElement } from '../../../bpmn-types';
import { DEFAULT_LABEL_SIZE, ELEMENT_LABEL_DISTANCE } from '../../../constants';
import { getVisibleElements, syncXml, getService } from '../../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

const BOUNDARY_EVENT_TYPE = 'bpmn:BoundaryEvent';

/** Check whether an element type has an external label. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/**
 * Compute the bpmn-js default label position for an element.
 *
 * Replicates `getExternalLabelMid()` from bpmn-js/lib/util/LabelUtil:
 *   centre = (element.centerX, element.bottom + DEFAULT_LABEL_SIZE.height / 2)
 *
 * Returns the top-left corner of the label rect.
 */
function getDefaultLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number
): { x: number; y: number } {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height + DEFAULT_LABEL_SIZE.height / 2;
  return {
    x: Math.round(midX - labelWidth / 2),
    y: Math.round(midY - labelHeight / 2),
  };
}

/**
 * Compute the left-side label position for boundary events.
 *
 * Boundary events have outgoing flows that exit downward, so placing the
 * label at the bottom would overlap the flow. Instead, place it to the left.
 */
function getBoundaryEventLabelPosition(
  element: { x: number; y: number; width: number; height: number },
  labelWidth: number,
  labelHeight: number
): { x: number; y: number } {
  const midY = element.y + element.height / 2;
  return {
    x: Math.round(element.x - ELEMENT_LABEL_DISTANCE - labelWidth),
    y: Math.round(midY - labelHeight / 2),
  };
}

/**
 * Check whether a boundary event has outgoing flows.
 */
function hasBoundaryOutgoingFlows(elementId: string, elements: any[]): boolean {
  return elements.some(
    (el) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.source?.id === elementId
  );
}

// ── Core adjustment logic ──────────────────────────────────────────────────

/**
 * Adjust all external labels in a diagram to bpmn-js default positions.
 *
 * Returns the number of labels that were moved.
 */
export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Collect all elements with external labels
  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );

  if (labelBearers.length === 0) return 0;

  let movedCount = 0;

  for (const el of labelBearers) {
    const label = el.label;
    if (!label) continue;

    const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
    const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

    let target: { x: number; y: number };

    // Boundary events with outgoing flows: place label to the left
    if (el.type === BOUNDARY_EVENT_TYPE && hasBoundaryOutgoingFlows(el.id, allElements)) {
      target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight);
    } else {
      target = getDefaultLabelPosition(el, labelWidth, labelHeight);
    }

    const dx = target.x - label.x;
    const dy = target.y - label.y;

    // Only move if displacement is significant (> 1px)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as unknown as BpmnElement, { x: dx, y: dy });
      movedCount++;
    }
  }

  if (movedCount > 0) {
    await syncXml(diagram);
  }

  return movedCount;
}

/**
 * Adjust the label for a single element (used after adding/connecting).
 *
 * Returns true if the label was moved.
 */
export async function adjustElementLabel(
  diagram: DiagramState,
  elementId: string
): Promise<boolean> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) {
    return false;
  }

  const label = el.label;
  const labelWidth = label.width || DEFAULT_LABEL_SIZE.width;
  const labelHeight = label.height || DEFAULT_LABEL_SIZE.height;

  let target: { x: number; y: number };

  if (
    el.type === BOUNDARY_EVENT_TYPE &&
    hasBoundaryOutgoingFlows(el.id, getVisibleElements(elementRegistry))
  ) {
    target = getBoundaryEventLabelPosition(el, labelWidth, labelHeight);
  } else {
    target = getDefaultLabelPosition(el, labelWidth, labelHeight);
  }

  const dx = target.x - label.x;
  const dy = target.y - label.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
    await syncXml(diagram);
    return true;
  }

  return false;
}

/**
 * Center flow labels on their connection's midpoint.
 *
 * After layout recomputes waypoints, flow labels may be stranded far
 * from their connection's current geometry. This pass repositions each
 * labeled flow's label so its centre sits at the flow's path midpoint.
 *
 * Returns the number of flow labels moved.
 */
export async function centerFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name &&
      el.waypoints &&
      el.waypoints.length >= 2
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label!;
    const waypoints = flow.waypoints!;

    // Compute midpoint of the connection path
    const midpoint = computeFlowMidpoint(waypoints);

    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    // Position label centred on midpoint
    const targetX = Math.round(midpoint.x - labelW / 2);
    const targetY = Math.round(midpoint.y - labelH / 2);

    const moveX = targetX - label.x;
    const moveY = targetY - label.y;

    // Only move if displacement is significant (> 2px)
    if (Math.abs(moveX) > 2 || Math.abs(moveY) > 2) {
      modeling.moveShape(label as unknown as BpmnElement, { x: moveX, y: moveY });
      movedCount++;
    }
  }

  if (movedCount > 0) await syncXml(diagram);
  return movedCount;
}

/**
 * Adjust flow labels — no-op kept for API compatibility.
 *
 * Flow labels are now positioned by `centerFlowLabels()` at the connection
 * midpoint, which is the bpmn-js default. No additional nudging is needed.
 *
 * Returns 0.
 */
export async function adjustFlowLabels(_diagram: DiagramState): Promise<number> {
  return 0;
}

// ── Flow midpoint computation ──────────────────────────────────────────────

/**
 * Compute the midpoint of a flow's waypoints for label placement.
 *
 * Walks 50% of the total path length to find the exact midpoint.
 */
function computeFlowMidpoint(waypoints: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
} {
  if (waypoints.length === 2) {
    return {
      x: (waypoints[0].x + waypoints[1].x) / 2,
      y: (waypoints[0].y + waypoints[1].y) / 2,
    };
  }

  // Walk to 50% of total path length
  let totalLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }

  const halfLength = totalLength / 2;
  let walked = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (walked + segLen >= halfLength && segLen > 0) {
      const t = (halfLength - walked) / segLen;
      return {
        x: waypoints[i - 1].x + dx * t,
        y: waypoints[i - 1].y + dy * t,
      };
    }
    walked += segLen;
  }

  // Fallback: geometric midpoint of first and last
  return {
    x: (waypoints[0].x + waypoints[waypoints.length - 1].x) / 2,
    y: (waypoints[0].y + waypoints[waypoints.length - 1].y) / 2,
  };
}
