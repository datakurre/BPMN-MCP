/**
 * A10-1: ELK native lane partitioning spike.
 *
 * Creates a throw-away test that manually sets `elk.partitioning.activate: 'true'`
 * and assigns `elk.partitioning.partition` on each ELK child node. Documents what
 * ELK partitioning actually does in the context of BPMN lane layout.
 *
 * FINDING: In `direction=RIGHT`, ELK partitioning assigns nodes to disjoint sets
 * of LAYERS (columns), not horizontal bands (rows). This means partition 0 nodes
 * appear LEFT OF partition 1 nodes, NOT above them. For BPMN lanes with direction=RIGHT
 * (horizontal flow, horizontal lane bands), ELK partitioning does NOT directly
 * produce the desired vertical band separation.
 *
 * For vertical band separation (BPMN lanes), a `direction=DOWN` layout with
 * partitioning WOULD work, but that changes the diagram flow direction.
 * The current post-hoc `repositionElementsIntoLaneBands()` approach is needed
 * for `direction=RIGHT` layouts.
 */

import { describe, test, expect } from 'vitest';

// Direct ELK import - this spike calls elkjs directly, bypassing bpmn-js
// to isolate the partitioning behaviour from BPMN model concerns.

describe('A10-1: ELK native lane partitioning spike', () => {
  /**
   * In direction=RIGHT, ELK partitioning creates COLUMN groups (layer groups).
   * Partition 0 nodes appear LEFT of partition 1 nodes.
   * This is NOT horizontal band separation - it is vertical column separation.
   */
  test('direction=RIGHT: ELK partitioning creates column groups (not row bands)', async () => {
    const ELK = (await import('elkjs')).default;
    const elk = new ELK();

    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.partitioning.activate': 'true',
        'elk.spacing.nodeNode': '20',
      },
      children: [
        { id: 'A1', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '0' } },
        { id: 'A2', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '0' } },
        { id: 'B1', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '1' } },
        { id: 'B2', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '1' } },
      ],
      edges: [
        { id: 'e1', sources: ['A1'], targets: ['B1'] },
        { id: 'e2', sources: ['A2'], targets: ['B2'] },
      ],
    };

    const result = await elk.layout(graph as any);

    const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const child of result.children ?? []) {
      nodes.set(child.id!, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0,
      });
    }
    expect(nodes.size).toBe(4);

    const a1 = nodes.get('A1')!;
    const a2 = nodes.get('A2')!;
    const b1 = nodes.get('B1')!;
    const b2 = nodes.get('B2')!;

    // FINDING: partition 0 nodes are to the LEFT of partition 1 nodes (column ordering)
    const maxXPartition0 = Math.max(a1.x + a1.width, a2.x + a2.width);
    const minXPartition1 = Math.min(b1.x, b2.x);
    expect(maxXPartition0).toBeLessThanOrEqual(minXPartition1);

    // Partition 0 nodes share a column (similar X range)
    expect(Math.abs(a1.x - a2.x)).toBeLessThan(10);
    // Partition 1 nodes share a column (similar X range)
    expect(Math.abs(b1.x - b2.x)).toBeLessThan(10);
  });

  /**
   * In direction=DOWN, ELK partitioning creates ROW groups.
   * Partition 0 nodes appear ABOVE partition 1 nodes.
   * This achieves horizontal band separation - but requires direction=DOWN.
   */
  test('direction=DOWN: ELK partitioning creates row bands (horizontal separation)', async () => {
    const ELK = (await import('elkjs')).default;
    const elk = new ELK();

    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.partitioning.activate': 'true',
      },
      children: [
        {
          id: 'Start',
          width: 36,
          height: 36,
          layoutOptions: { 'elk.partitioning.partition': '0' },
        },
        {
          id: 'Task_A',
          width: 100,
          height: 80,
          layoutOptions: { 'elk.partitioning.partition': '0' },
        },
        {
          id: 'Task_B',
          width: 100,
          height: 80,
          layoutOptions: { 'elk.partitioning.partition': '0' },
        },
        {
          id: 'Task_C',
          width: 100,
          height: 80,
          layoutOptions: { 'elk.partitioning.partition': '1' },
        },
        {
          id: 'Task_D',
          width: 100,
          height: 80,
          layoutOptions: { 'elk.partitioning.partition': '1' },
        },
        { id: 'End', width: 36, height: 36, layoutOptions: { 'elk.partitioning.partition': '1' } },
      ],
      edges: [
        { id: 'e1', sources: ['Start'], targets: ['Task_A'] },
        { id: 'e2', sources: ['Task_A'], targets: ['Task_B'] },
        { id: 'e3', sources: ['Task_C'], targets: ['Task_D'] },
        { id: 'e4', sources: ['Task_D'], targets: ['End'] },
        { id: 'e5', sources: ['Task_A'], targets: ['Task_C'] },
      ],
    };

    const result = await elk.layout(graph as any);

    const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const child of result.children ?? []) {
      nodes.set(child.id!, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0,
      });
    }
    expect(nodes.size).toBe(6);

    const lane0Nodes = ['Start', 'Task_A', 'Task_B'].map((id) => nodes.get(id)!);
    const lane1Nodes = ['Task_C', 'Task_D', 'End'].map((id) => nodes.get(id)!);

    const lane0MaxBottom = Math.max(...lane0Nodes.map((n) => n.y + n.height));
    const lane1MinTop = Math.min(...lane1Nodes.map((n) => n.y));

    // direction=DOWN with partitioning: partition 0 ends above partition 1 start
    expect(lane0MaxBottom).toBeLessThanOrEqual(lane1MinTop);
  });

  /**
   * Confirms: partitioning in direction=RIGHT orders nodes by X (column/layer),
   * not by Y (row/band). Post-hoc repositionElementsIntoLaneBands() is still needed.
   */
  test('FINDING: partitioning in direction=RIGHT orders columns not rows', async () => {
    const ELK = (await import('elkjs')).default;
    const elk = new ELK();

    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.partitioning.activate': 'true',
      },
      children: [
        { id: 'N0', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '0' } },
        { id: 'N1', width: 100, height: 80, layoutOptions: { 'elk.partitioning.partition': '1' } },
      ],
      edges: [{ id: 'e1', sources: ['N0'], targets: ['N1'] }],
    };

    const result = await elk.layout(graph as any);
    const nodes = result.children ?? [];
    const n0 = nodes.find((c) => c.id === 'N0');
    const n1 = nodes.find((c) => c.id === 'N1');

    expect(n0).toBeDefined();
    expect(n1).toBeDefined();

    // direction=RIGHT: partition 0 is LEFT of partition 1 (column ordering)
    expect((n0?.x ?? 0) + (n0?.width ?? 0)).toBeLessThanOrEqual(n1?.x ?? 0);
  });
});
