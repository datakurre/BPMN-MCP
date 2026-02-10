/**
 * ELK graph construction from bpmn-js element registry.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import { ELK_LAYOUT_OPTIONS, CONTAINER_PADDING, PARTICIPANT_PADDING } from './constants';
import { isConnection, isInfrastructure, isArtifact, isLane } from './helpers';

/**
 * Build ELK child nodes and internal edges for a given container element.
 *
 * A "container" is any element whose children should be laid out together:
 * the root canvas element, a Participant (pool), or an expanded SubProcess.
 */
export function buildContainerGraph(
  allElements: any[],
  container: any
): { children: ElkNode[]; edges: ElkExtendedEdge[] } {
  const children: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];
  const nodeIds = new Set<string>();

  // Direct child shapes (skip connections, boundary events, infrastructure, artifacts, lanes)
  const childShapes = allElements.filter(
    (el: any) =>
      el.parent === container &&
      !isInfrastructure(el.type) &&
      !isConnection(el.type) &&
      !isArtifact(el.type) &&
      !isLane(el.type) &&
      el.type !== 'bpmn:BoundaryEvent'
  );

  for (const shape of childShapes) {
    nodeIds.add(shape.id);

    // Check if this shape is a container with layoutable children
    const hasChildren = allElements.some(
      (el: any) =>
        el.parent === shape &&
        !isInfrastructure(el.type) &&
        !isConnection(el.type) &&
        el.type !== 'bpmn:BoundaryEvent'
    );

    if (hasChildren) {
      // Compound node — recurse
      const isParticipant = shape.type === 'bpmn:Participant';
      const nested = buildContainerGraph(allElements, shape);
      children.push({
        id: shape.id,
        width: shape.width || 300,
        height: shape.height || 200,
        children: nested.children,
        edges: nested.edges,
        layoutOptions: {
          ...ELK_LAYOUT_OPTIONS,
          'elk.padding': isParticipant ? PARTICIPANT_PADDING : CONTAINER_PADDING,
        },
      });
    } else {
      children.push({
        id: shape.id,
        width: shape.width || 100,
        height: shape.height || 80,
      });
    }
  }

  // Connections whose source AND target are both in this container
  const childConnections = allElements.filter(
    (el: any) => el.parent === container && isConnection(el.type) && el.source && el.target
  );

  for (const conn of childConnections) {
    if (nodeIds.has(conn.source.id) && nodeIds.has(conn.target.id)) {
      edges.push({
        id: conn.id,
        sources: [conn.source.id],
        targets: [conn.target.id],
      });
    }
  }

  // Include proxy edges for boundary event flows.
  // Boundary events are excluded from ELK nodes, but their outgoing flows
  // need to be represented so ELK positions the targets properly (e.g.
  // error end events, recovery tasks).  We use the boundary event's host
  // as the proxy source, with a synthetic edge ID to avoid conflicts with
  // the actual connection's edge routing.
  const boundaryEvents = allElements.filter(
    (el: any) => el.parent === container && el.type === 'bpmn:BoundaryEvent' && el.host
  );
  for (const be of boundaryEvents) {
    const hostId = be.host.id;
    if (!nodeIds.has(hostId)) continue;

    // Find outgoing flows from this boundary event
    const beOutgoing = childConnections.filter(
      (conn: any) => conn.source.id === be.id && nodeIds.has(conn.target.id)
    );
    for (const conn of beOutgoing) {
      edges.push({
        id: `__boundary_proxy__${conn.id}`,
        sources: [hostId],
        targets: [conn.target.id],
      });
    }
  }

  return { children, edges };
}
