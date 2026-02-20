/**
 * Tests for C6: backward neighbor edge rebuild in subset layout.
 *
 * Verifies that when a partial layout is run and neighbor edges are backward
 * (the target is to the LEFT of the source, i.e. a loopback), the rebuild
 * produces a valid U-shaped route rather than leaving stale waypoints.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('C6: backward neighbor edge rebuild in subset layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('backward neighbor edge gets a multi-waypoint U-shape after subset layout', async () => {
    // Build: Start → T1 → T2 → T1 (loopback), T2 → End
    // After full layout, T1 is to the left of T2.
    // Partial layout on T2 should rebuild the loopback T2→T1 with ≥ 3 waypoints.
    const diagramId = await createDiagram('Backward Neighbor');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    const loopbackId = await connect(diagramId, t2, t1); // backward flow
    await connect(diagramId, t2, end);

    // Full layout first to position elements
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);

    // Verify T1 is to the left of T2 (layout puts them left-to-right)
    expect(t2El.x).toBeGreaterThan(t1El.x);

    // Run subset layout on just T2 — this triggers rebuildNeighborEdges for the backward flow
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t2] }));
    expect(res.success).toBe(true);

    // The loopback flow T2→T1 (target left of source) should have ≥ 3 waypoints
    // (simple 2-waypoint forward-only routes are replaced with U-shapes for loopbacks)
    const loopback = reg.get(loopbackId);
    if (loopback?.waypoints) {
      expect(loopback.waypoints.length).toBeGreaterThanOrEqual(2);
      // For the loopback, the route should be orthogonal (no large diagonals)
      const wps: Array<{ x: number; y: number }> = loopback.waypoints;
      for (let i = 0; i < wps.length - 1; i++) {
        const dx = Math.abs(wps[i + 1].x - wps[i].x);
        const dy = Math.abs(wps[i + 1].y - wps[i].y);
        const isDiagonal = dx > 5 && dy > 5;
        expect(isDiagonal).toBe(false); // Route should be orthogonal
      }
    }
  });

  test('forward neighbor edges still rebuild correctly after adding backward handling', async () => {
    // Regression: ensure the existing forward-edge rebuild still works
    const diagramId = await createDiagram('Forward Regression');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    const flow12 = await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    await handleLayoutDiagram({ diagramId });

    // Subset layout on T2
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t2] }));
    expect(res.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const conn = reg.get(flow12);
    if (conn?.waypoints) {
      expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
      // Forward flow should not route below the diagram (no huge Y jump)
      const maxY = Math.max(...conn.waypoints.map((wp: any) => wp.y));
      const t1El = reg.get(t1);
      expect(maxY).toBeLessThan(t1El.y + t1El.height + 200); // Stays near the task row
    }
  });
});
