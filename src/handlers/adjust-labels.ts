/**
 * Post-processing function that adjusts external labels to avoid overlaps
 * with connections and other labels.
 *
 * Entry points:
 * - `adjustDiagramLabels(diagram)` — adjusts all labels in a diagram
 * - `adjustElementLabel(diagram, elementId)` — adjusts a single element's label
 */

import { type DiagramState } from '../types';
import { FLOW_LABEL_INDENT } from '../constants';
import {
  type Point,
  type Rect,
  getLabelCandidatePositions,
  scoreLabelPosition,
  rectsOverlap,
} from './label-utils';
import { getVisibleElements, syncXml } from './helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check whether an element type has an external label. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/** Collect all connection segments from all visible connections. */
function collectConnectionSegments(elements: any[]): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (const el of elements) {
    if (
      (el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type === 'bpmn:Association') &&
      el.waypoints?.length >= 2
    ) {
      for (let i = 0; i < el.waypoints.length - 1; i++) {
        segments.push([
          { x: el.waypoints[i].x, y: el.waypoints[i].y },
          { x: el.waypoints[i + 1].x, y: el.waypoints[i + 1].y },
        ]);
      }
    }
  }
  return segments;
}

/** Get the bounding rect of a label shape. */
function getLabelRect(label: any): Rect {
  return {
    x: label.x,
    y: label.y,
    width: label.width || 90,
    height: label.height || 20,
  };
}

// ── Core adjustment logic ──────────────────────────────────────────────────

/**
 * Adjust all external labels in a diagram to minimise overlap with
 * connections and other labels.
 *
 * Returns the number of labels that were moved.
 */
export async function adjustDiagramLabels(diagram: DiagramState): Promise<number> {
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const connectionSegments = collectConnectionSegments(allElements);

  // Collect all elements with external labels
  const labelBearers = allElements.filter(
    (el: any) => hasExternalLabel(el.type) && el.label && el.businessObject?.name
  );

  if (labelBearers.length === 0) return 0;

  // Collect current label rects for cross-label overlap checking
  const labelRects = new Map<string, Rect>();
  for (const el of labelBearers) {
    if (el.label) {
      labelRects.set(el.id, getLabelRect(el.label));
    }
  }

  let movedCount = 0;

  for (const el of labelBearers) {
    const label = el.label;
    if (!label) continue;

    const currentRect = getLabelRect(label);
    const otherLabelRects = Array.from(labelRects.entries())
      .filter(([id]) => id !== el.id)
      .map(([, r]) => r);

    // Host rect for boundary events
    let hostRect: Rect | undefined;
    if (el.type === 'bpmn:BoundaryEvent' && el.host) {
      hostRect = {
        x: el.host.x,
        y: el.host.y,
        width: el.host.width,
        height: el.host.height,
      };
    }

    // Score the current position
    const currentScore = scoreLabelPosition(
      currentRect,
      connectionSegments,
      otherLabelRects,
      hostRect
    );

    if (currentScore === 0) continue; // already fine

    // Try all candidate positions
    const candidates = getLabelCandidatePositions(el);
    let bestScore = currentScore;
    let bestCandidate: (typeof candidates)[0] | null = null;

    for (const candidate of candidates) {
      const score = scoreLabelPosition(
        candidate.rect,
        connectionSegments,
        otherLabelRects,
        hostRect
      );
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      // Move the label
      const dx = bestCandidate.rect.x - label.x;
      const dy = bestCandidate.rect.y - label.y;
      if (dx !== 0 || dy !== 0) {
        modeling.moveShape(label, { x: dx, y: dy });
        // Update the tracked rect
        labelRects.set(el.id, bestCandidate.rect);
        movedCount++;
      }
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
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const el = elementRegistry.get(elementId);

  if (!el || !el.label || !hasExternalLabel(el.type) || !el.businessObject?.name) {
    return false;
  }

  const allElements = getVisibleElements(elementRegistry);
  const connectionSegments = collectConnectionSegments(allElements);

  // Other labels
  const otherLabelRects: Rect[] = allElements
    .filter((other: any) => other.id !== elementId && other.label && hasExternalLabel(other.type))
    .map((other: any) => getLabelRect(other.label));

  // Host rect for boundary events
  let hostRect: Rect | undefined;
  if (el.type === 'bpmn:BoundaryEvent' && el.host) {
    hostRect = { x: el.host.x, y: el.host.y, width: el.host.width, height: el.host.height };
  }

  const label = el.label;
  const currentRect = getLabelRect(label);
  const currentScore = scoreLabelPosition(
    currentRect,
    connectionSegments,
    otherLabelRects,
    hostRect
  );

  if (currentScore === 0) return false;

  const candidates = getLabelCandidatePositions(el);
  let bestScore = currentScore;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const score = scoreLabelPosition(candidate.rect, connectionSegments, otherLabelRects, hostRect);
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    const dx = bestCandidate.rect.x - label.x;
    const dy = bestCandidate.rect.y - label.y;
    if (dx !== 0 || dy !== 0) {
      modeling.moveShape(label, { x: dx, y: dy });
      await syncXml(diagram);
      return true;
    }
  }

  return false;
}

// ── Connection (flow) label adjustment ─────────────────────────────────────

/**
 * Adjust labels on connections (sequence flows) to avoid overlapping shapes.
 *
 * Flow labels are placed at the midpoint of waypoints. If a label overlaps
 * with an element shape, nudge it perpendicular to the flow direction.
 *
 * Returns the number of flow labels moved.
 */
export async function adjustFlowLabels(diagram: DiagramState): Promise<number> {
  const modeling = diagram.modeler.get('modeling');
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  // Collect all shape rects (non-connections)
  const shapeRects: Rect[] = allElements
    .filter(
      (el: any) =>
        el.type &&
        !el.type.includes('SequenceFlow') &&
        !el.type.includes('MessageFlow') &&
        !el.type.includes('Association') &&
        el.width &&
        el.height
    )
    .map((el: any) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

  // Find connections with labels
  const labeledFlows = allElements.filter(
    (el: any) =>
      (el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow') &&
      el.label &&
      el.businessObject?.name
  );

  let movedCount = 0;

  for (const flow of labeledFlows) {
    const label = flow.label;
    const labelRect = getLabelRect(label);

    // Check if label overlaps any shape
    const overlapping = shapeRects.some((sr) => rectsOverlap(labelRect, sr));
    if (!overlapping) continue;

    // Compute flow direction at midpoint
    const waypoints = flow.waypoints;
    if (!waypoints || waypoints.length < 2) continue;

    const midIdx = Math.floor(waypoints.length / 2);
    const p1 = waypoints[midIdx - 1] || waypoints[0];
    const p2 = waypoints[midIdx];

    // Perpendicular direction
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular unit vector
    const perpX = -dy / len;
    const perpY = dx / len;

    // Try nudging in both perpendicular directions
    const nudgeAmount = FLOW_LABEL_INDENT + 10;
    const nudges = [
      { x: perpX * nudgeAmount, y: perpY * nudgeAmount },
      { x: -perpX * nudgeAmount, y: -perpY * nudgeAmount },
    ];

    let bestNudge: { x: number; y: number } | null = null;
    for (const nudge of nudges) {
      const nudgedRect: Rect = {
        x: labelRect.x + nudge.x,
        y: labelRect.y + nudge.y,
        width: labelRect.width,
        height: labelRect.height,
      };
      if (!shapeRects.some((sr) => rectsOverlap(nudgedRect, sr))) {
        bestNudge = nudge;
        break;
      }
    }

    if (bestNudge) {
      modeling.moveShape(label, bestNudge);
      movedCount++;
    }
  }

  if (movedCount > 0) {
    await syncXml(diagram);
  }

  return movedCount;
}
