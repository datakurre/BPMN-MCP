/**
 * Unit tests for the rebuild-based layout engine — Phase 1: Topology Analyser.
 *
 * Tests against programmatically built diagrams (fixture-builders) to verify:
 * - Flow graph extraction (1.1)
 * - Back-edge detection (1.2)
 * - Topological sort with layer assignment (1.3)
 * - Gateway fan-out/merge pattern detection (1.4)
 * - Container hierarchy (1.5)
 * - Boundary event identification (1.6)
 */

import { describe, test, expect, afterEach } from 'vitest';
import {
  extractFlowGraph,
  detectBackEdges,
  topologicalSort,
  groupByLayer,
  detectGatewayPatterns,
  buildContainerHierarchy,
  getContainerRebuildOrder,
  identifyBoundaryEvents,
} from '../../src/rebuild';
import { clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import type { ElementRegistry } from '../../src/bpmn-types';
import {
  buildF01LinearFlow,
  buildF02ExclusiveGateway,
  buildF03ParallelForkJoin,
  buildF04NestedSubprocess,
  buildF05Collaboration,
  buildF06BoundaryEvents,
  buildF09ComplexWorkflow,
} from '../scenarios/fixture-builders';

afterEach(() => clearDiagrams());

// ── Helper to get registry ─────────────────────────────────────────────────

function getRegistry(diagramId: string): ElementRegistry {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as ElementRegistry;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1.1 — Flow graph extraction
// ═══════════════════════════════════════════════════════════════════════════

describe('extractFlowGraph', () => {
  test('01-linear-flow: extracts a simple chain with correct node count', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    // linear-flow: StartEvent + 3 tasks + EndEvent = 5 nodes
    expect(graph.nodes.size).toBe(5);
    expect(graph.startNodeIds.length).toBe(1);
    expect(graph.endNodeIds.length).toBe(1);
  });

  test('01-linear-flow: start node is a StartEvent', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    const startNode = graph.nodes.get(graph.startNodeIds[0])!;
    expect(startNode.element.type).toBe('bpmn:StartEvent');
    expect(startNode.incoming.length).toBe(0);
    expect(startNode.outgoing.length).toBe(1);
  });

  test('01-linear-flow: end node is an EndEvent', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    const endNode = graph.nodes.get(graph.endNodeIds[0])!;
    expect(endNode.element.type).toBe('bpmn:EndEvent');
    expect(endNode.outgoing.length).toBe(0);
    expect(endNode.incoming.length).toBe(1);
  });

  test('01-linear-flow: each node has correct in/out degree', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    // In a linear chain: start(0,1), task(1,1), task(1,1), task(1,1), end(1,0)
    const degrees = [...graph.nodes.values()].map((n) => ({
      in: n.incoming.length,
      out: n.outgoing.length,
    }));

    expect(degrees).toContainEqual({ in: 0, out: 1 }); // start
    expect(degrees).toContainEqual({ in: 1, out: 0 }); // end
    expect(degrees.filter((d) => d.in === 1 && d.out === 1).length).toBe(3); // tasks
  });

  test('02-exclusive-gateway: extracts gateway nodes', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    // 7 nodes: Start, Review, Gateway(split), Fulfill, Reject, Gateway(merge), End
    expect(graph.nodes.size).toBe(7);

    // Find gateways
    const gateways = [...graph.nodes.values()].filter(
      (n) => n.element.type === 'bpmn:ExclusiveGateway'
    );
    expect(gateways.length).toBe(2);
  });

  test('02-exclusive-gateway: split gateway has 2 outgoing', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    const splitGateway = [...graph.nodes.values()].find(
      (n) => n.element.type === 'bpmn:ExclusiveGateway' && n.outgoing.length === 2
    );
    expect(splitGateway).toBeDefined();
    expect(splitGateway!.incoming.length).toBe(1);
  });

  test('03-parallel-fork-join: fork has 3 outgoing', async () => {
    const ids = await buildF03ParallelForkJoin();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    // 7 nodes: Start, Fork, 3 tasks, Join, End
    expect(graph.nodes.size).toBe(7);

    const fork = [...graph.nodes.values()].find(
      (n) => n.element.type === 'bpmn:ParallelGateway' && n.outgoing.length === 3
    );
    expect(fork).toBeDefined();
  });

  test('06-boundary-events: excludes boundary events from flow graph', async () => {
    const ids = await buildF06BoundaryEvents();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    // Should NOT include the boundary event as a flow node
    const types = [...graph.nodes.values()].map((n) => n.element.type);
    expect(types).not.toContain('bpmn:BoundaryEvent');
  });

  test('06-boundary-events: excludes artifacts and connections', async () => {
    const ids = await buildF06BoundaryEvents();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);

    const types = [...graph.nodes.values()].map((n) => n.element.type);
    expect(types).not.toContain('bpmn:SequenceFlow');
    expect(types).not.toContain('bpmn:Association');
    expect(types).not.toContain('bpmn:TextAnnotation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1.2 — Back-edge detection
// ═══════════════════════════════════════════════════════════════════════════

describe('detectBackEdges', () => {
  test('01-linear-flow: no back-edges in a simple chain', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);

    expect(backEdges.size).toBe(0);
  });

  test('02-exclusive-gateway: no back-edges in a diamond', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);

    expect(backEdges.size).toBe(0);
  });

  test('03-parallel-fork-join: no back-edges in fork-join', async () => {
    const ids = await buildF03ParallelForkJoin();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);

    expect(backEdges.size).toBe(0);
  });

  test('09-complex-workflow: no back-edges (no loops in this diagram)', async () => {
    const ids = await buildF09ComplexWorkflow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);

    expect(backEdges.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1.3 — Topological sort with layer assignment
// ═══════════════════════════════════════════════════════════════════════════

describe('topologicalSort', () => {
  test('01-linear-flow: assigns sequential layers 0..4', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    // 5 nodes, layers 0..4
    expect(sorted.length).toBe(5);
    const layers = sorted.map((n) => n.layer);
    expect(Math.min(...layers)).toBe(0);
    expect(Math.max(...layers)).toBe(4);

    // Each node should have a unique layer in a linear chain
    const uniqueLayers = new Set(layers);
    expect(uniqueLayers.size).toBe(5);
  });

  test('01-linear-flow: start event is at layer 0', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    const startNode = sorted.find((n) => {
      const node = graph.nodes.get(n.elementId)!;
      return node.element.type === 'bpmn:StartEvent';
    });
    expect(startNode).toBeDefined();
    expect(startNode!.layer).toBe(0);
  });

  test('01-linear-flow: end event is at the last layer', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    const endNode = sorted.find((n) => {
      const node = graph.nodes.get(n.elementId)!;
      return node.element.type === 'bpmn:EndEvent';
    });
    expect(endNode).toBeDefined();
    expect(endNode!.layer).toBe(4);
  });

  test('02-exclusive-gateway: branches share the same layer', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    // Fulfill and Reject should be at the same layer (after split gateway)
    const fulfill = sorted.find((n) => n.elementId === ids.fulfill);
    const reject = sorted.find((n) => n.elementId === ids.reject);
    expect(fulfill).toBeDefined();
    expect(reject).toBeDefined();
    expect(fulfill!.layer).toBe(reject!.layer);
  });

  test('03-parallel-fork-join: 3 parallel tasks share the same layer', async () => {
    const ids = await buildF03ParallelForkJoin();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    // Three tasks after fork should share the same layer
    const taskIds = [ids.branch1, ids.branch2, ids.branch3];
    const taskLayers = taskIds
      .map((id) => sorted.find((n) => n.elementId === id))
      .filter(Boolean)
      .map((n) => n!.layer);

    expect(taskLayers.length).toBe(3);
    expect(new Set(taskLayers).size).toBe(1); // All same layer
  });

  test('groupByLayer produces correct groups', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);
    const groups = groupByLayer(sorted);

    // Should have layers from 0 to max
    expect(groups.size).toBeGreaterThanOrEqual(4);

    // Layer 0 should contain the start event
    const layer0 = groups.get(0)!;
    expect(layer0.length).toBe(1);
    const startNode = graph.nodes.get(layer0[0])!;
    expect(startNode.element.type).toBe('bpmn:StartEvent');
  });

  test('09-complex-workflow: all nodes get a layer', async () => {
    const ids = await buildF09ComplexWorkflow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const sorted = topologicalSort(graph, backEdges);

    // All flow nodes should appear in the sorted output
    expect(sorted.length).toBe(graph.nodes.size);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1.4 — Gateway fan-out and merge pattern detection
// ═══════════════════════════════════════════════════════════════════════════

describe('detectGatewayPatterns', () => {
  test('01-linear-flow: no gateway patterns', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const patterns = detectGatewayPatterns(graph, backEdges);

    expect(patterns.length).toBe(0);
  });

  test('02-exclusive-gateway: detects one split with merge', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const patterns = detectGatewayPatterns(graph, backEdges);

    expect(patterns.length).toBe(1);

    const pattern = patterns[0];
    expect(pattern.splitId).toBe(ids.split);
    expect(pattern.mergeId).toBe(ids.merge);
    expect(pattern.branches.length).toBe(2);
  });

  test('02-exclusive-gateway: branches contain correct elements', async () => {
    const ids = await buildF02ExclusiveGateway();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const patterns = detectGatewayPatterns(graph, backEdges);

    const pattern = patterns[0];
    // Each branch should contain exactly one task
    const branchElements = pattern.branches.flat();
    expect(branchElements).toContain(ids.fulfill);
    expect(branchElements).toContain(ids.reject);
  });

  test('03-parallel-fork-join: detects fork with 3 branches', async () => {
    const ids = await buildF03ParallelForkJoin();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const patterns = detectGatewayPatterns(graph, backEdges);

    expect(patterns.length).toBe(1);

    const pattern = patterns[0];
    expect(pattern.splitId).toBe(ids.fork);
    expect(pattern.mergeId).toBe(ids.join);
    expect(pattern.branches.length).toBe(3);
  });

  test('09-complex-workflow: detects multiple gateway patterns', async () => {
    const ids = await buildF09ComplexWorkflow();
    const registry = getRegistry(ids.diagramId);
    const graph = extractFlowGraph(registry);
    const backEdges = detectBackEdges(graph);
    const patterns = detectGatewayPatterns(graph, backEdges);

    // Should detect at least the exclusive split
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    // Verify the registration type gateway is detected
    const regTypePattern = patterns.find((p) => p.splitId === ids.regTypeGateway);
    expect(regTypePattern).toBeDefined();
    expect(regTypePattern!.branches.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1.5 — Container hierarchy
// ═══════════════════════════════════════════════════════════════════════════

describe('buildContainerHierarchy', () => {
  test('01-linear-flow: single root container (Process)', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const hierarchy = buildContainerHierarchy(registry);

    expect(hierarchy.roots.length).toBe(1);
    const root = hierarchy.roots[0];
    expect(root.element.type).toBe('bpmn:Process');
    expect(root.children.length).toBe(0);
    expect(root.flowNodeIds.length).toBe(5);
  });

  test('04-nested-subprocess: detects subprocess container', async () => {
    const ids = await buildF04NestedSubprocess();
    const registry = getRegistry(ids.diagramId);
    const hierarchy = buildContainerHierarchy(registry);

    // Should have containers (Process and SubProcess)
    expect(hierarchy.containers.size).toBeGreaterThanOrEqual(2);

    // Should detect at least one subprocess
    const subprocesses = [...hierarchy.containers.values()].filter(
      (c) => c.element.type === 'bpmn:SubProcess'
    );
    expect(subprocesses.length).toBeGreaterThanOrEqual(1);
  });

  test('05-collaboration: detects participant containers', async () => {
    const ids = await buildF05Collaboration();
    const registry = getRegistry(ids.diagramId);
    const hierarchy = buildContainerHierarchy(registry);

    // Should have at least one participant
    const participants = [...hierarchy.containers.values()].filter(
      (c) => c.element.type === 'bpmn:Participant'
    );
    expect(participants.length).toBeGreaterThanOrEqual(1);
  });

  test('getContainerRebuildOrder: deepest containers first', async () => {
    const ids = await buildF04NestedSubprocess();
    const registry = getRegistry(ids.diagramId);
    const hierarchy = buildContainerHierarchy(registry);
    const order = getContainerRebuildOrder(hierarchy);

    // The order should have children before parents
    expect(order.length).toBeGreaterThanOrEqual(2);

    // The last element should be a root container
    const lastContainer = order[order.length - 1];
    expect(hierarchy.roots).toContainEqual(lastContainer);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1.6 — Boundary events and exception chains
// ═══════════════════════════════════════════════════════════════════════════

describe('identifyBoundaryEvents', () => {
  test('01-linear-flow: no boundary events', async () => {
    const ids = await buildF01LinearFlow();
    const registry = getRegistry(ids.diagramId);
    const boundaryInfos = identifyBoundaryEvents(registry);

    expect(boundaryInfos.length).toBe(0);
  });

  test('06-boundary-events: detects the timer boundary event', async () => {
    const ids = await buildF06BoundaryEvents();
    const registry = getRegistry(ids.diagramId);
    const boundaryInfos = identifyBoundaryEvents(registry);

    expect(boundaryInfos.length).toBe(1);

    const info = boundaryInfos[0];
    expect(info.boundaryEvent.type).toBe('bpmn:BoundaryEvent');
    expect(info.host.type).toBe('bpmn:UserTask');
    expect(info.host.id).toBe(ids.host);
  });

  test('06-boundary-events: exception chain contains Escalate task and EndEvent', async () => {
    const ids = await buildF06BoundaryEvents();
    const registry = getRegistry(ids.diagramId);
    const boundaryInfos = identifyBoundaryEvents(registry);

    const info = boundaryInfos[0];
    // The chain should contain the Escalate task and the Escalated end event
    expect(info.exceptionChain.length).toBe(2);
    expect(info.exceptionChain).toContain(ids.escalate);
    expect(info.exceptionChain).toContain(ids.escalatedEnd);
  });

  test('09-complex-workflow: detects 2 boundary events', async () => {
    const ids = await buildF09ComplexWorkflow();
    const registry = getRegistry(ids.diagramId);
    const boundaryInfos = identifyBoundaryEvents(registry);

    expect(boundaryInfos.length).toBe(2);

    // Verify hosts by returned IDs
    const hostIds = boundaryInfos.map((b) => b.host.id).sort();
    expect(hostIds).toContain(ids.processPayment);
    expect(hostIds).toContain(ids.reviewTask);
  });

  test('09-complex-workflow: each boundary event has an exception chain', async () => {
    const ids = await buildF09ComplexWorkflow();
    const registry = getRegistry(ids.diagramId);
    const boundaryInfos = identifyBoundaryEvents(registry);

    for (const info of boundaryInfos) {
      // Each boundary event should have at least one element in its chain
      // (the end event it connects to)
      expect(info.exceptionChain.length).toBeGreaterThanOrEqual(1);
    }
  });
});
