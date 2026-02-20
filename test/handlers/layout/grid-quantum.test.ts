/**
 * Tests for pixel-level grid snapping (D3).
 *
 * Verifies that when `gridSnap` is a number (e.g. 10), all shape positions
 * and intermediate waypoints are snapped to the nearest multiple of that
 * quantum after layout.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('grid quantum snapping (D3)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('all element positions are multiples of 10px after layout with gridSnap:10', async () => {
    const diagramId = await createDiagram('Grid Quantum Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision?' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task C' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, gw);
    await connect(diagramId, gw, t2);
    await connect(diagramId, gw, t3);
    await connect(diagramId, t2, end);
    await connect(diagramId, t3, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: 10 }));
    expect(res.success).toBe(true);

    // Re-export and check positions from the result elements
    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId);
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const elements = elementRegistry.getAll() as Array<{
      id: string;
      type: string;
      x?: number;
      y?: number;
      width?: number;
    }>;

    const quantum = 10;
    const shapeTypes = [
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:UserTask',
      'bpmn:ExclusiveGateway',
    ];

    for (const el of elements) {
      if (!shapeTypes.includes(el.type)) continue;
      if (el.x === undefined || el.y === undefined) continue;

      // x and y should be multiples of the quantum
      expect(
        el.x % quantum,
        `Element ${el.id} (${el.type}): x=${el.x} is not a multiple of ${quantum}`
      ).toBe(0);
      expect(
        el.y % quantum,
        `Element ${el.id} (${el.type}): y=${el.y} is not a multiple of ${quantum}`
      ).toBe(0);
    }
  });

  test('all element positions are multiples of 5px after layout with gridSnap:5', async () => {
    const diagramId = await createDiagram('Grid 5px Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: 5 }));
    expect(res.success).toBe(true);

    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId);
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const elements = elementRegistry.getAll() as Array<{
      id: string;
      type: string;
      x?: number;
      y?: number;
    }>;

    const quantum = 5;
    for (const el of elements) {
      if (!['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:UserTask'].includes(el.type)) continue;
      if (el.x === undefined || el.y === undefined) continue;

      expect(el.x % quantum, `Element ${el.id}: x=${el.x} is not a multiple of ${quantum}`).toBe(0);
      expect(el.y % quantum, `Element ${el.id}: y=${el.y} is not a multiple of ${quantum}`).toBe(0);
    }
  });

  test('intermediate waypoints are multiples of 10px after gridSnap:10', async () => {
    const diagramId = await createDiagram('Waypoint Snap Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const gw2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, t1);
    await connect(diagramId, gw, t2);
    await connect(diagramId, t1, gw2);
    await connect(diagramId, t2, gw2);
    await connect(diagramId, gw2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: 10 }));
    expect(res.success).toBe(true);

    const { getDiagram } = await import('../../../src/diagram-manager');
    const diagram = getDiagram(diagramId);
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const connections = (
      elementRegistry.getAll() as Array<{
        id: string;
        type: string;
        waypoints?: Array<{ x: number; y: number }>;
      }>
    ).filter((el) => el.waypoints && el.waypoints.length >= 3);

    const quantum = 10;
    // Check intermediate waypoints (skip first and last endpoints)
    for (const conn of connections) {
      const wps = conn.waypoints!;
      for (let i = 1; i < wps.length - 1; i++) {
        const wp = wps[i];
        expect(
          wp.x % quantum,
          `Connection ${conn.id} waypoint[${i}]: x=${wp.x} is not a multiple of ${quantum}`
        ).toBe(0);
        expect(
          wp.y % quantum,
          `Connection ${conn.id} waypoint[${i}]: y=${wp.y} is not a multiple of ${quantum}`
        ).toBe(0);
      }
    }
  });

  test('layout without gridSnap does not enforce multiples of 10', async () => {
    // When gridSnap is not set (boolean default), positions may not be
    // multiples of 10 — verify the snap is not forced on by default.
    // This is a smoke test to ensure gridSnap: 10 is opt-in.
    const diagramId = await createDiagram('No Grid Snap Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // Test passes as long as layout succeeds — positions may or may not
    // be multiples of 10 (the grid snap pass is not auto-applied)
  });
});
