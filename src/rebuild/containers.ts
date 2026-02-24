/**
 * Container hierarchy analysis for the rebuild-based layout engine.
 *
 * Builds a tree of containers: Process → Participant → SubProcess → ...
 * Each container gets its own rebuild scope.  Elements inside a subprocess
 * are rebuilt before the subprocess is sized.  Pools are rebuilt
 * independently, then positioned relative to each other.
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

// ── Types ──────────────────────────────────────────────────────────────────

/** A node in the container hierarchy tree. */
export interface ContainerNode {
  /** The container element (Process, Participant, or SubProcess). */
  element: BpmnElement;
  /** Child containers nested inside this one. */
  children: ContainerNode[];
  /** IDs of flow nodes that are direct children of this container
   *  (not inside a nested subprocess). */
  flowNodeIds: string[];
  /** Whether this is an event subprocess (triggered by event). */
  isEventSubprocess: boolean;
  /** Whether this container is expanded (has visible internal elements). */
  isExpanded: boolean;
}

/** The complete container hierarchy for a diagram. */
export interface ContainerHierarchy {
  /** The root container(s) — typically one Process or multiple Participants. */
  roots: ContainerNode[];
  /** Flat map of element ID → ContainerNode for quick lookup. */
  containers: Map<string, ContainerNode>;
}

// ── Hierarchy analysis ─────────────────────────────────────────────────────

/**
 * Build the container hierarchy from an ElementRegistry.
 *
 * Analyses the parent-child relationships in the element registry to
 * build a tree of containers (Process, Participant, SubProcess).
 * Each container's direct flow node children are recorded for rebuild
 * scoping.
 *
 * @param registry  The bpmn-js ElementRegistry service.
 * @returns         The ContainerHierarchy.
 */
export function buildContainerHierarchy(registry: ElementRegistry): ContainerHierarchy {
  const allElements: BpmnElement[] = registry.getAll();
  return buildContainerHierarchyFromElements(allElements);
}

/**
 * Build the container hierarchy from a flat list of elements.
 * Separated from registry-based wrapper for testability.
 */
export function buildContainerHierarchyFromElements(
  allElements: BpmnElement[]
): ContainerHierarchy {
  const containers = new Map<string, ContainerNode>();
  const roots: ContainerNode[] = [];

  // 1. Identify all container elements
  for (const el of allElements) {
    if (isContainerType(el)) {
      containers.set(el.id, {
        element: el,
        children: [],
        flowNodeIds: [],
        isEventSubprocess:
          el.type === 'bpmn:SubProcess' && el.businessObject?.triggeredByEvent === true,
        isExpanded: el.type !== 'bpmn:SubProcess' || el.isExpanded !== false,
      });
    }
  }

  // 2. Build parent-child relationships between containers
  for (const [, node] of containers) {
    const parent = findParentContainer(node.element, containers);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // 3. Assign flow nodes to their direct container
  for (const el of allElements) {
    if (!isFlowNodeForHierarchy(el)) continue;

    const parentContainer = findDirectContainer(el, containers);
    if (parentContainer) {
      parentContainer.flowNodeIds.push(el.id);
    }
  }

  // 4. Sort children for deterministic ordering:
  //    event subprocesses come after regular subprocesses
  for (const [, node] of containers) {
    node.children.sort((a, b) => {
      if (a.isEventSubprocess !== b.isEventSubprocess) {
        return a.isEventSubprocess ? 1 : -1;
      }
      return a.element.y - b.element.y;
    });
  }

  return { roots, containers };
}

/**
 * Get the rebuild order for containers (inside-out: deepest first).
 *
 * Returns containers in the order they should be rebuilt:
 * deepest subprocesses first, then their parents, finally the root.
 * This ensures that when a container is being positioned, its internal
 * elements have already been laid out and its size is known.
 */
export function getContainerRebuildOrder(hierarchy: ContainerHierarchy): ContainerNode[] {
  const order: ContainerNode[] = [];

  function postOrder(node: ContainerNode): void {
    for (const child of node.children) {
      postOrder(child);
    }
    order.push(node);
  }

  for (const root of hierarchy.roots) {
    postOrder(root);
  }

  return order;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check if an element is a container that can hold flow nodes. */
function isContainerType(el: BpmnElement): boolean {
  return (
    el.type === 'bpmn:Process' ||
    el.type === 'bpmn:Participant' ||
    (el.type === 'bpmn:SubProcess' && el.isExpanded !== false)
  );
}

/** Check if an element is a flow node for hierarchy assignment purposes. */
function isFlowNodeForHierarchy(el: BpmnElement): boolean {
  const type = el.type;
  return (
    type !== 'bpmn:Process' &&
    type !== 'bpmn:Collaboration' &&
    type !== 'bpmn:Participant' &&
    type !== 'bpmn:Lane' &&
    type !== 'bpmn:LaneSet' &&
    type !== 'bpmn:SequenceFlow' &&
    type !== 'bpmn:MessageFlow' &&
    type !== 'bpmn:Association' &&
    type !== 'bpmn:TextAnnotation' &&
    type !== 'bpmn:DataObjectReference' &&
    type !== 'bpmn:DataStoreReference' &&
    type !== 'bpmn:Group' &&
    type !== 'label' &&
    !type.includes('BPMNDiagram') &&
    !type.includes('BPMNPlane')
  );
}

/** Find the nearest parent that is a container. */
function findParentContainer(
  el: BpmnElement,
  containers: Map<string, ContainerNode>
): ContainerNode | undefined {
  let current = el.parent;
  while (current) {
    const container = containers.get(current.id);
    if (container) return container;
    current = current.parent;
  }
  return undefined;
}

/** Find the direct container for a flow node. */
function findDirectContainer(
  el: BpmnElement,
  containers: Map<string, ContainerNode>
): ContainerNode | undefined {
  // The direct parent of a flow node should be a container
  if (el.parent) {
    const container = containers.get(el.parent.id);
    if (container) return container;
  }
  return findParentContainer(el, containers);
}
