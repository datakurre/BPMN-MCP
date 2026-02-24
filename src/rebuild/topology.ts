/**
 * Flow graph extraction and topology analysis for the rebuild-based layout engine.
 *
 * Given an ElementRegistry, builds an adjacency list of flow nodes connected
 * by sequence flows.  Excludes connections, infrastructure (Process,
 * Collaboration), artifacts, and lanes.  Includes tasks, events, gateways,
 * subprocesses, and call activities.
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

// ── Types ──────────────────────────────────────────────────────────────────

/** A node in the flow graph with its incoming and outgoing neighbours. */
export interface FlowNode {
  /** The original bpmn-js element. */
  element: BpmnElement;
  /** Outgoing neighbours (connected by sequence flows leaving this node). */
  outgoing: FlowNode[];
  /** Incoming neighbours (connected by sequence flows entering this node). */
  incoming: FlowNode[];
  /** IDs of outgoing sequence flow connections. */
  outgoingFlowIds: string[];
  /** IDs of incoming sequence flow connections. */
  incomingFlowIds: string[];
}

/** The complete flow graph for a container scope. */
export interface FlowGraph {
  /** Map of element ID → FlowNode for all flow nodes in the scope. */
  nodes: Map<string, FlowNode>;
  /** IDs of start nodes (no incoming edges within this scope). */
  startNodeIds: string[];
  /** IDs of end nodes (no outgoing edges within this scope). */
  endNodeIds: string[];
}

// ── Type classification helpers ────────────────────────────────────────────

/** Connection types that form the flow graph edges. */
function isSequenceFlow(type: string): boolean {
  return type === 'bpmn:SequenceFlow';
}

/** Infrastructure elements excluded from the flow graph. */
function isInfrastructure(type: string): boolean {
  return (
    !type ||
    type === 'bpmn:Process' ||
    type === 'bpmn:Collaboration' ||
    type === 'label' ||
    type.includes('BPMNDiagram') ||
    type.includes('BPMNPlane')
  );
}

/** Connection types excluded from the flow graph nodes. */
function isConnection(type: string): boolean {
  return type === 'bpmn:SequenceFlow' || type === 'bpmn:MessageFlow' || type === 'bpmn:Association';
}

/** Artifact types excluded from the flow graph. */
function isArtifact(type: string): boolean {
  return (
    type === 'bpmn:TextAnnotation' ||
    type === 'bpmn:DataObjectReference' ||
    type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:Group'
  );
}

/** Lane types excluded from the flow graph. */
function isLane(type: string): boolean {
  return type === 'bpmn:Lane' || type === 'bpmn:LaneSet';
}

/**
 * Check if an element is a flow node that should be included in the
 * flow graph.  Includes tasks, events, gateways, subprocesses, and
 * call activities.  Excludes boundary events (handled separately),
 * connections, infrastructure, artifacts, lanes, and participants.
 */
export function isFlowNode(el: BpmnElement): boolean {
  return (
    !isInfrastructure(el.type) &&
    !isConnection(el.type) &&
    !isArtifact(el.type) &&
    !isLane(el.type) &&
    el.type !== 'label' &&
    el.type !== 'bpmn:Participant' &&
    el.type !== 'bpmn:BoundaryEvent'
  );
}

// ── Flow graph extraction ──────────────────────────────────────────────────

/**
 * Extract a flow graph from an ElementRegistry for a given container scope.
 *
 * Builds an adjacency list of flow nodes connected by sequence flows.
 * Only considers direct children of the container (not nested inside
 * subprocesses).
 *
 * @param registry  The bpmn-js ElementRegistry service.
 * @param container Optional container element (Process, Participant, or
 *                  SubProcess).  Defaults to the root element.
 * @returns         The FlowGraph for the container scope.
 */
export function extractFlowGraph(registry: ElementRegistry, container?: BpmnElement): FlowGraph {
  const allElements: BpmnElement[] = registry.getAll();
  return extractFlowGraphFromElements(allElements, container);
}

/**
 * Extract a flow graph from a flat list of elements for a given container.
 *
 * This is the core implementation, separated from the registry-based
 * wrapper for testability with raw element arrays.
 */
export function extractFlowGraphFromElements(
  allElements: BpmnElement[],
  container?: BpmnElement
): FlowGraph {
  const nodes = new Map<string, FlowNode>();

  // Resolve the effective container: if not specified, use the root element
  // (the element with no parent, or the canvas root).
  const effectiveContainer = container ?? findRootContainer(allElements);

  // 1. Collect flow nodes that are direct children of the container
  for (const el of allElements) {
    if (el.parent !== effectiveContainer) continue;
    if (!isFlowNode(el)) continue;

    nodes.set(el.id, {
      element: el,
      outgoing: [],
      incoming: [],
      outgoingFlowIds: [],
      incomingFlowIds: [],
    });
  }

  // 2. Build edges from sequence flows within the container
  for (const el of allElements) {
    if (el.parent !== effectiveContainer) continue;
    if (!isSequenceFlow(el.type)) continue;
    if (!el.source || !el.target) continue;

    const sourceNode = nodes.get(el.source.id);
    const targetNode = nodes.get(el.target.id);

    if (sourceNode && targetNode) {
      sourceNode.outgoing.push(targetNode);
      sourceNode.outgoingFlowIds.push(el.id);
      targetNode.incoming.push(sourceNode);
      targetNode.incomingFlowIds.push(el.id);
    }
  }

  // 3. Identify start and end nodes
  const startNodeIds: string[] = [];
  const endNodeIds: string[] = [];

  for (const [id, node] of nodes) {
    if (node.incoming.length === 0) {
      startNodeIds.push(id);
    }
    if (node.outgoing.length === 0) {
      endNodeIds.push(id);
    }
  }

  // Sort start nodes: bpmn:StartEvent first, then by Y position
  startNodeIds.sort((a, b) => {
    const aNode = nodes.get(a)!;
    const bNode = nodes.get(b)!;
    const aIsStart = aNode.element.type === 'bpmn:StartEvent' ? 0 : 1;
    const bIsStart = bNode.element.type === 'bpmn:StartEvent' ? 0 : 1;
    if (aIsStart !== bIsStart) return aIsStart - bIsStart;
    return aNode.element.y - bNode.element.y;
  });

  return { nodes, startNodeIds, endNodeIds };
}

/**
 * Find the root container element (Process or Collaboration canvas root).
 * Falls back to the first element whose parent is the canvas root.
 */
function findRootContainer(allElements: BpmnElement[]): BpmnElement | undefined {
  // The bpmn-js canvas root is the element with type 'bpmn:Process' or
  // 'bpmn:Collaboration' that has no parent, or whose parent type is
  // a BPMNDiagram/BPMNPlane.
  for (const el of allElements) {
    if (
      (el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration') &&
      (!el.parent ||
        el.parent.type?.includes('BPMNPlane') ||
        el.parent.type?.includes('BPMNDiagram'))
    ) {
      return el;
    }
  }
  // Fallback: return the parent of any flow node
  for (const el of allElements) {
    if (isFlowNode(el) && el.parent) {
      return el.parent;
    }
  }
  return undefined;
}
