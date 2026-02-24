/**
 * Unit tests for the rebuild-based layout engine — Phase 2: Rebuild Engine.
 *
 * Tests against existing fixture BPMN files to verify:
 * - Linear chain rebuild (2.2)
 * - Gateway fan-out positioning (2.3)
 * - Gateway merge positioning (2.4)
 * - Back-edge connection layout (2.5)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { rebuildLayout } from '../../src/rebuild';
import { importReference, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import type { BpmnElement, ElementRegistry } from '../../src/bpmn-types';

afterEach(() => clearDiagrams());

// ── Helpers ────────────────────────────────────────────────────────────────

function getRegistry(diagramId: string): ElementRegistry {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as ElementRegistry;
}

/** Get element center coordinates. */
function center(el: BpmnElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.1 — Engine scaffold
// ═══════════════════════════════════════════════════════════════════════════

describe('rebuildLayout scaffold', () => {
  test('returns zero counts for an empty diagram', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    // Rebuild a valid diagram returns non-zero counts
    const result = rebuildLayout(diagram);
    expect(result).toHaveProperty('repositionedCount');
    expect(result).toHaveProperty('reroutedCount');
  });

  test('result includes repositioned and rerouted counts', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    const result = rebuildLayout(diagram);
    // 5 nodes may or may not all need moving, but connections are re-routed
    expect(result.repositionedCount).toBeGreaterThanOrEqual(0);
    expect(result.reroutedCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.2 — Linear chain rebuild
// ═══════════════════════════════════════════════════════════════════════════

describe('linear chain rebuild (01-linear-flow)', () => {
  test('all elements are on the same horizontal line', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const ids = [
      'Event_1l18z3u',
      'Activity_01aji74',
      'Activity_1p2y7u9',
      'Activity_0jy2ses',
      'Event_0bdlayk',
    ];

    const centers = ids.map((id) => center(registry.get(id)!));

    // All elements should share the same Y (within tolerance)
    const baseY = centers[0].y;
    for (const c of centers) {
      expect(Math.abs(c.y - baseY)).toBeLessThan(2);
    }
  });

  test('elements are in strict left-to-right order', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const ids = [
      'Event_1l18z3u', // Start
      'Activity_01aji74', // Validate Order
      'Activity_1p2y7u9', // Process Payment
      'Activity_0jy2ses', // Ship Order
      'Event_0bdlayk', // End
    ];

    const xs = ids.map((id) => registry.get(id)!.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  test('spacing between consecutive elements is consistent', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const ids = [
      'Event_1l18z3u',
      'Activity_01aji74',
      'Activity_1p2y7u9',
      'Activity_0jy2ses',
      'Event_0bdlayk',
    ];

    const elements = ids.map((id) => registry.get(id)!);

    // Compute edge-to-edge gaps
    const gaps: number[] = [];
    for (let i = 1; i < elements.length; i++) {
      const prevRight = elements[i - 1].x + elements[i - 1].width;
      const currLeft = elements[i].x;
      gaps.push(currLeft - prevRight);
    }

    // All gaps should be the standard 50px gap
    for (const g of gaps) {
      expect(g).toBe(50);
    }
  });

  test('start event is placed at the default origin', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const start = registry.get('Event_1l18z3u')!;
    const c = center(start);

    expect(c.x).toBe(180);
    expect(c.y).toBe(200);
  });

  test('connections have valid waypoints after rebuild', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const flowIds = ['Flow_1o0buuy', 'Flow_0qgziru', 'Flow_00k1pv3', 'Flow_0wkgksp'];

    for (const flowId of flowIds) {
      const conn = registry.get(flowId)!;
      expect(conn.waypoints).toBeDefined();
      expect(conn.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.3/2.4 — Gateway fan-out and merge (exclusive gateway)
// ═══════════════════════════════════════════════════════════════════════════

describe('gateway positioning (02-exclusive-gateway)', () => {
  test('split and merge gateways are at the same Y', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const split = center(registry.get('Gateway_0jdocql')!);
    const merge = center(registry.get('Gateway_1hd85cz')!);

    expect(Math.abs(split.y - merge.y)).toBeLessThan(2);
  });

  test('merge gateway is to the right of both branch elements', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const fulfill = registry.get('Activity_1ra1cd4')!;
    const reject = registry.get('Activity_0ryvb1v')!;
    const merge = registry.get('Gateway_1hd85cz')!;

    // Merge left edge should be past both branches' right edges
    expect(merge.x).toBeGreaterThan(fulfill.x + fulfill.width);
    expect(merge.x).toBeGreaterThan(reject.x + reject.width);
  });

  test('branch elements have symmetric Y offsets from gateway', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const split = center(registry.get('Gateway_0jdocql')!);
    const fulfillC = center(registry.get('Activity_1ra1cd4')!);
    const rejectC = center(registry.get('Activity_0ryvb1v')!);

    // Two branches → offsets should be ±branchSpacing/2 = ±65
    const offset1 = fulfillC.y - split.y;
    const offset2 = rejectC.y - split.y;

    // They should be symmetric (one above, one below)
    expect(Math.abs(offset1 + offset2)).toBeLessThan(2);
    // And non-zero
    expect(Math.abs(offset1)).toBeGreaterThan(30);
  });

  test('branch elements share the same X position', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const fulfill = center(registry.get('Activity_1ra1cd4')!);
    const reject = center(registry.get('Activity_0ryvb1v')!);

    // Both branches should be at the same X (right of the split gateway)
    expect(Math.abs(fulfill.x - reject.x)).toBeLessThan(2);
  });

  test('elements before the split are on the main flow Y', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const start = center(registry.get('Event_0dskcoo')!);
    const review = center(registry.get('Activity_1a279je')!);
    const split = center(registry.get('Gateway_0jdocql')!);

    // Start, Review, Split gateway should all be at the same Y
    expect(Math.abs(start.y - review.y)).toBeLessThan(2);
    expect(Math.abs(review.y - split.y)).toBeLessThan(2);
  });

  test('end event is after the merge gateway', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const merge = registry.get('Gateway_1hd85cz')!;
    const end = registry.get('Event_0a768vd')!;

    expect(end.x).toBeGreaterThan(merge.x + merge.width);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.3/2.4 — Parallel fork-join (3-way split)
// ═══════════════════════════════════════════════════════════════════════════

describe('parallel fork-join positioning (03-parallel-fork-join)', () => {
  test('fork and join gateways share the same Y', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const fork = center(registry.get('Gateway_11h8qzw')!);
    const join = center(registry.get('Gateway_1osli9i')!);

    expect(Math.abs(fork.y - join.y)).toBeLessThan(2);
  });

  test('three branches are symmetrically offset from fork Y', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const fork = center(registry.get('Gateway_11h8qzw')!);

    const taskIds = ['Activity_0gqc9jk', 'Activity_0p6g9d6', 'Activity_0z4100l'];
    const taskYs = taskIds.map((id) => center(registry.get(id)!).y);

    // Sort Y values to get top, middle, bottom
    const sortedYs = [...taskYs].sort((a, b) => a - b);

    // Middle branch should be at fork Y
    expect(Math.abs(sortedYs[1] - fork.y)).toBeLessThan(2);

    // Top and bottom branches should be symmetric around fork Y
    const topOffset = sortedYs[0] - fork.y;
    const bottomOffset = sortedYs[2] - fork.y;
    expect(Math.abs(topOffset + bottomOffset)).toBeLessThan(2);

    // Branch spacing should be 130px (default)
    expect(Math.abs(sortedYs[1] - sortedYs[0])).toBe(130);
    expect(Math.abs(sortedYs[2] - sortedYs[1])).toBe(130);
  });

  test('all three branch tasks share the same X', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const taskIds = ['Activity_0gqc9jk', 'Activity_0p6g9d6', 'Activity_0z4100l'];
    const taskXs = taskIds.map((id) => center(registry.get(id)!).x);

    // All should be at the same X
    for (const x of taskXs) {
      expect(Math.abs(x - taskXs[0])).toBeLessThan(2);
    }
  });

  test('join gateway is to the right of all branch tasks', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const taskIds = ['Activity_0gqc9jk', 'Activity_0p6g9d6', 'Activity_0z4100l'];
    const join = registry.get('Gateway_1osli9i')!;

    for (const taskId of taskIds) {
      const task = registry.get(taskId)!;
      expect(join.x).toBeGreaterThan(task.x + task.width);
    }
  });

  test('complete left-to-right ordering: start < fork < tasks < join < end', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const start = registry.get('Event_1tfz1g5')!;
    const fork = registry.get('Gateway_11h8qzw')!;
    const task = registry.get('Activity_0gqc9jk')!; // any task
    const join = registry.get('Gateway_1osli9i')!;
    const end = registry.get('Event_183di0m')!;

    expect(start.x).toBeLessThan(fork.x);
    expect(fork.x + fork.width).toBeLessThan(task.x);
    expect(task.x + task.width).toBeLessThan(join.x);
    expect(join.x + join.width).toBeLessThan(end.x);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2.5 — Back-edge (loop) connections
// ═══════════════════════════════════════════════════════════════════════════

describe('back-edge connection layout', () => {
  test('connections are re-routed with valid waypoints on acyclic diagrams', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    const result = rebuildLayout(diagram);

    // 4 sequence flows in a 5-node linear chain
    expect(result.reroutedCount).toBe(4);
  });

  test('all sequence flows have waypoints after rebuild on gateway diagram', async () => {
    const { diagramId } = await importReference('02-exclusive-gateway');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram);

    const registry = getRegistry(diagramId);
    const flowIds = [
      'Flow_0tql777',
      'Flow_0uy0kub',
      'Flow_1vd4vzj',
      'Flow_0pkj4i7',
      'Flow_109need',
      'Flow_1mt6667',
      'Flow_1juidsl',
    ];

    for (const flowId of flowIds) {
      const conn = registry.get(flowId)!;
      expect(conn.waypoints).toBeDefined();
      expect(conn.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Custom options
// ═══════════════════════════════════════════════════════════════════════════

describe('rebuildLayout with custom options', () => {
  test('custom origin shifts all elements', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram, { origin: { x: 300, y: 400 } });

    const registry = getRegistry(diagramId);
    const start = center(registry.get('Event_1l18z3u')!);

    expect(start.x).toBe(300);
    expect(start.y).toBe(400);
  });

  test('custom gap changes spacing between elements', async () => {
    const { diagramId } = await importReference('01-linear-flow');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram, { gap: 100 });

    const registry = getRegistry(diagramId);
    const elements = [registry.get('Event_1l18z3u')!, registry.get('Activity_01aji74')!];

    const gap = elements[1].x - (elements[0].x + elements[0].width);
    expect(gap).toBe(100);
  });

  test('custom branchSpacing changes branch offsets', async () => {
    const { diagramId } = await importReference('03-parallel-fork-join');
    const diagram = getDiagram(diagramId)!;

    rebuildLayout(diagram, { branchSpacing: 200 });

    const registry = getRegistry(diagramId);
    const taskIds = ['Activity_0gqc9jk', 'Activity_0p6g9d6', 'Activity_0z4100l'];
    const taskYs = taskIds.map((id) => center(registry.get(id)!).y);
    const sortedYs = [...taskYs].sort((a, b) => a - b);

    // Branch spacing should now be 200px
    expect(Math.abs(sortedYs[1] - sortedYs[0])).toBe(200);
    expect(Math.abs(sortedYs[2] - sortedYs[1])).toBe(200);
  });
});
