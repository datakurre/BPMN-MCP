/**
 * Artifact positioning and label adjustment for the rebuild engine.
 *
 * Handles:
 * - Text annotations: positioned above-right of their associated element
 * - Data objects/stores: positioned below-right of their associated element
 * - Association / data-association layout after repositioning
 * - Flow labels: centered on connection midpoints
 * - Element labels: placed at bpmn-js default positions (below element center)
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { DEFAULT_LABEL_SIZE, ELEMENT_LABEL_DISTANCE } from '../constants';

// ── Constants ──────────────────────────────────────────────────────────────

/** Element types treated as artifacts (excluded from main flow). */
const ARTIFACT_TYPES = new Set([
  'bpmn:TextAnnotation',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
]);

/**
 * Connection types used to link artifacts to flow nodes.
 * bpmn:Association links TextAnnotation ↔ flow node.
 * DataInput/OutputAssociation links DataObject/DataStore ↔ flow node.
 */
const ARTIFACT_CONNECTION_TYPES = new Set([
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

// ── Artifact positioning ───────────────────────────────────────────────────

/**
 * Reposition artifacts (text annotations, data objects, data stores)
 * relative to their associated flow node.
 *
 * Text annotations are placed above-right of the source element,
 * matching bpmn-js `getTextAnnotationPosition()` from BpmnAutoPlaceUtil.
 *
 * Data objects/stores are placed below-right of the source element,
 * matching bpmn-js `getDataElementPosition()` from BpmnAutoPlaceUtil.
 *
 * After repositioning artifacts, associated connections (associations
 * and data associations) are re-laid out.
 *
 * @returns Number of artifacts repositioned.
 */
export function positionArtifacts(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement
): number {
  const allElements: BpmnElement[] = registry.getAll();
  const artifacts = allElements.filter(
    (el) => el.parent === container && ARTIFACT_TYPES.has(el.type)
  );

  if (artifacts.length === 0) return 0;

  let repositioned = 0;

  for (const artifact of artifacts) {
    const source = findAssociatedElement(artifact);
    if (!source) continue;

    const position = computeArtifactPosition(artifact, source);
    const currentCenterX = artifact.x + artifact.width / 2;
    const currentCenterY = artifact.y + artifact.height / 2;

    const dx = Math.round(position.x - currentCenterX);
    const dy = Math.round(position.y - currentCenterY);

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveElements([artifact], { x: dx, y: dy });
      repositioned++;
    }
  }

  // Layout artifact connections after repositioning
  layoutArtifactConnections(registry, modeling, container);

  return repositioned;
}

/**
 * Find the flow node associated with an artifact via connections.
 * Checks both incoming and outgoing connections, returning the first
 * non-artifact endpoint found.
 */
function findAssociatedElement(artifact: BpmnElement): BpmnElement | null {
  // Check outgoing connections (artifact → flow node)
  for (const conn of artifact.outgoing ?? []) {
    if (conn.target && !ARTIFACT_TYPES.has(conn.target.type)) {
      return conn.target;
    }
  }
  // Check incoming connections (flow node → artifact)
  for (const conn of artifact.incoming ?? []) {
    if (conn.source && !ARTIFACT_TYPES.has(conn.source.type)) {
      return conn.source;
    }
  }
  return null;
}

/**
 * Compute the target center position for an artifact relative to its
 * associated source element.
 *
 * Uses the same offsets as bpmn-js BpmnAutoPlaceUtil (horizontal mode):
 * - TextAnnotation: right edge + width/2, top - 50 - height/2
 * - DataObjectReference / DataStoreReference: right - 10 + width/2,
 *   bottom + 40 + height/2
 */
function computeArtifactPosition(
  artifact: BpmnElement,
  source: BpmnElement
): { x: number; y: number } {
  const sourceRight = source.x + source.width;

  if (artifact.type === 'bpmn:TextAnnotation') {
    return {
      x: sourceRight + artifact.width / 2,
      y: source.y - 50 - artifact.height / 2,
    };
  }

  // Data objects / data stores — below-right of source
  return {
    x: sourceRight - 10 + artifact.width / 2,
    y: source.y + source.height + 40 + artifact.height / 2,
  };
}

/**
 * Layout all artifact connections (associations + data associations)
 * within a container after artifacts have been repositioned.
 */
function layoutArtifactConnections(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement
): void {
  const allElements: BpmnElement[] = registry.getAll();

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (ARTIFACT_CONNECTION_TYPES.has(el.type)) {
      modeling.layoutConnection(el);
    }
  }
}

// ── Label adjustment ───────────────────────────────────────────────────────

/**
 * Adjust all labels in the diagram to bpmn-js default positions.
 * Synchronous — no syncXml needed (caller handles XML sync).
 *
 * 1. Centers flow labels on their connection's midpoint.
 * 2. Adjusts element labels (events, gateways, data objects) to
 *    default positions below their element center.
 *
 * @returns Number of labels moved.
 */
export function adjustLabels(registry: ElementRegistry, modeling: Modeling): number {
  let count = 0;
  count += centerFlowLabels(registry, modeling);
  count += adjustElementLabels(registry, modeling);
  return count;
}

// ── Flow label centering ───────────────────────────────────────────────────

/**
 * Center labeled flow (sequence/message flow) labels on the connection
 * midpoint.  After layout recomputes waypoints, labels may be stranded
 * from their connection's current geometry.
 */
function centerFlowLabels(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();
  let count = 0;

  for (const flow of allElements) {
    if (flow.type !== 'bpmn:SequenceFlow' && flow.type !== 'bpmn:MessageFlow') continue;
    if (!flow.label || !flow.businessObject?.name) continue;
    if (!flow.waypoints || flow.waypoints.length < 2) continue;

    const midpoint = computePathMidpoint(flow.waypoints);
    const labelW = flow.label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = flow.label.height || DEFAULT_LABEL_SIZE.height;

    const targetX = Math.round(midpoint.x - labelW / 2);
    const targetY = Math.round(midpoint.y - labelH / 2);

    const dx = targetX - flow.label.x;
    const dy = targetY - flow.label.y;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      modeling.moveShape(flow.label as unknown as BpmnElement, { x: dx, y: dy });
      count++;
    }
  }

  return count;
}

// ── Element label adjustment ───────────────────────────────────────────────

/** Element types that have external labels in BPMN. */
function hasExternalLabel(type: string): boolean {
  return (
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataObjectReference'
  );
}

/**
 * Adjust external labels (events, gateways, data objects) to the bpmn-js
 * default position: centered below the element.
 *
 * Replicates `getExternalLabelMid()` from bpmn-js LabelUtil.
 */
function adjustElementLabels(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();
  let count = 0;

  for (const el of allElements) {
    if (!hasExternalLabel(el.type)) continue;
    if (!el.label || !el.businessObject?.name) continue;

    const label = el.label;
    const labelW = label.width || DEFAULT_LABEL_SIZE.width;
    const labelH = label.height || DEFAULT_LABEL_SIZE.height;

    // bpmn-js default: centre below element
    const midX = el.x + el.width / 2;
    const midY = el.y + el.height + ELEMENT_LABEL_DISTANCE + labelH / 2;

    const targetX = Math.round(midX - labelW / 2);
    const targetY = Math.round(midY - labelH / 2);

    const dx = targetX - label.x;
    const dy = targetY - label.y;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveShape(label as BpmnElement, { x: dx, y: dy });
      count++;
    }
  }

  return count;
}

// ── Path midpoint computation ──────────────────────────────────────────────

/**
 * Compute the midpoint of a polyline path for label placement.
 * Walks 50% of the total path length to find the exact midpoint.
 */
function computePathMidpoint(waypoints: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
} {
  if (waypoints.length === 2) {
    return {
      x: (waypoints[0].x + waypoints[1].x) / 2,
      y: (waypoints[0].y + waypoints[1].y) / 2,
    };
  }

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
