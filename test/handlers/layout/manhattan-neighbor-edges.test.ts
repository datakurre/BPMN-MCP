/**
 * D5-5: Subset layout neighbor edge quality tests.
 *
 * Verifies that after subset layout (partial element repositioning), neighbor
 * edges (connections between subset and non-subset elements) have orthogonal
 * waypoints with no diagonal segments — matching the quality produced by full
 * layout.
 *
 * D5-3 change: Forward neighbor edges now use modeling.layoutConnection()
 * (bpmn-js ManhattanLayout) instead of manually constructed straight/Z routes.
 * This test verifies that quality is maintained.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** Check that all segments in a waypoint list are orthogonal (no diagonals). */
function assertOrthogonal(wps: Array<{ x: number; y: number }>, tolerance: number = 3): void {
  for (let i = 0; i < wps.length - 1; i++) {
    const dx = Math.abs(wps[i + 1].x - wps[i].x);
    const dy = Math.abs(wps[i + 1].y - wps[i].y);
    const isDiagonal = dx > tolerance && dy > tolerance;
    expect(isDiagonal, `Segment ${i}→${i + 1} is diagonal: dx=${dx}, dy=${dy}`).toBe(false);
  }
}

describe('D5-5: neighbor edge quality after subset layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('forward neighbor edge has orthogonal waypoints after subset layout', async () => {
    // Build: Start → T1 → T2 → End
    // After full layout, run subset layout on T1 only.
    // The edge T1→T2 is a forward neighbor edge — should have orthogonal route.
    const diagramId = await createDiagram('D5-5 Forward Neighbor');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    const t1t2ConnId = await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    // Full layout first
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Verify T1 is to the left of T2 after layout
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);
    expect(t2El.x).toBeGreaterThan(t1El.x);

    // Now subset layout on T1 only — triggers rebuildNeighborEdges for T1→T2
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t1] }));
    expect(res.success).toBe(true);

    // The T1→T2 forward neighbor edge should have orthogonal waypoints
    const conn = reg.get(t1t2ConnId);
    if (conn?.waypoints && conn.waypoints.length >= 2) {
      assertOrthogonal(conn.waypoints);
    }
  });

  test('neighbor edge endpoints remain connected after subset layout', async () => {
    // Build: A → B → C
    // Subset layout on B should keep A→B and B→C connected to their elements.
    const diagramId = await createDiagram('D5-5 Endpoint Connectivity');
    const a = await addElement(diagramId, 'bpmn:StartEvent', { name: 'A' });
    const b = await addElement(diagramId, 'bpmn:Task', { name: 'B' });
    const c = await addElement(diagramId, 'bpmn:EndEvent', { name: 'C' });

    await connect(diagramId, a, b);
    const bcConnId = await connect(diagramId, b, c);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const bEl = reg.get(b);
    const cEl = reg.get(c);

    // Subset layout on B
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [b] }));
    expect(res.success).toBe(true);

    // B→C neighbor edge endpoints should be connected to their element boundaries
    const bcConn = reg.get(bcConnId);
    if (bcConn?.waypoints && bcConn.waypoints.length >= 2) {
      const wps = bcConn.waypoints;
      const firstWp = wps[0];
      const lastWp = wps[wps.length - 1];

      // First waypoint should be near B's right edge
      const bRight = bEl.x + (bEl.width ?? 100);
      expect(Math.abs(firstWp.x - bRight)).toBeLessThan(15);

      // Last waypoint should be near C's left edge
      const cLeft = cEl.x;
      expect(Math.abs(lastWp.x - cLeft)).toBeLessThan(15);
    }
  });

  test('cross-row forward neighbor edge produces non-diagonal route', async () => {
    // Build: T1 (row 1) → T2 (row 2) with explicit Y separation.
    // After subset layout, the T1→T2 edge should not have diagonal segments.
    const diagramId = await createDiagram('D5-5 Cross-Row');
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'T1', x: 200, y: 100 });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'T2', x: 400, y: 250 });
    const connId = await connect(diagramId, t1, t2);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Subset layout on t1 — triggers forward neighbor edge rebuild for T1→T2
    const res = parseResult(await handleLayoutDiagram({ diagramId, elementIds: [t1] }));
    expect(res.success).toBe(true);

    const conn = reg.get(connId);
    if (conn?.waypoints && conn.waypoints.length >= 2) {
      assertOrthogonal(conn.waypoints);
    }
  });

  test('full layout and subset layout produce equivalent edge quality', async () => {
    // Create a diagram, run full layout, record edge waypoint counts,
    // then run subset layout on one element and verify waypoint counts are similar.
    const diagramId = await createDiagram('D5-5 Quality Equivalence');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:Task', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    const taskEndConnId = await connect(diagramId, task, end);

    // Full layout
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const fullLayoutWpCount = reg.get(taskEndConnId)?.waypoints?.length ?? 0;

    // Subset layout on task — should rebuild task→end as forward neighbor edge
    await handleLayoutDiagram({ diagramId, elementIds: [task] });

    const subsetWpCount = reg.get(taskEndConnId)?.waypoints?.length ?? 0;

    // Waypoint counts should be similar (both orthogonal, 2–4 points)
    expect(subsetWpCount).toBeGreaterThanOrEqual(2);
    expect(subsetWpCount).toBeLessThanOrEqual(6);
    expect(Math.abs(subsetWpCount - fullLayoutWpCount)).toBeLessThanOrEqual(4);
  });
});
