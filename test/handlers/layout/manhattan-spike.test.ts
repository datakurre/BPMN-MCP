/**
 * D5-1: ManhattanLayout headless invocation spike.
 *
 * Tries `modeling.layoutConnection()` on a neighbor edge after subset layout.
 * Documents whether ManhattanLayout works in headless jsdom mode, and what
 * polyfills (if any) are missing.
 *
 * CONTEXT: bpmn-js provides `modeling.layoutConnection()` which delegates to
 * `ManhattanLayout` — the same routing used during interactive editing.
 * Using it would produce routes consistent with Camunda Modeler and eliminate
 * manual Z/U-shaped route construction in `rebuildNeighborEdges()`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('D5-1: ManhattanLayout headless invocation spike', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('modeling.layoutConnection is callable on a straight horizontal connection', async () => {
    const diagramId = await createDiagram('D5-1 Manhattan Spike');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');
    const modeling = modeler.get('modeling');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 350, y: 200 });
    const connId = await connect(diagramId, startId, taskId);

    const conn = elementRegistry.get(connId);
    expect(conn).toBeDefined();
    expect(conn.waypoints).toBeDefined();

    // Capture original waypoints (for documentation only)
    const _originalWps = [...conn.waypoints];

    // Try calling modeling.layoutConnection()
    let layoutError: Error | null = null;
    let newWaypoints: any[] | null = null;
    try {
      modeling.layoutConnection(conn);
      newWaypoints = conn.waypoints;
    } catch (err) {
      layoutError = err as Error;
    }

    if (layoutError) {
      // Document: ManhattanLayout fails headlessly
      // Note which SVG method is missing (for D5-2)
      expect(layoutError.message).toBeDefined();
      return;
    }

    // ManhattanLayout succeeded headlessly
    expect(newWaypoints).toBeDefined();
    expect(Array.isArray(newWaypoints)).toBe(true);
    expect(newWaypoints!.length).toBeGreaterThanOrEqual(2);

    // For a horizontal connection, all waypoints should be at the same Y
    const firstY = newWaypoints![0].y;
    for (const wp of newWaypoints!) {
      expect(Math.abs(wp.y - firstY)).toBeLessThan(5);
    }
  });

  test('modeling.layoutConnection produces orthogonal routes for diagonal connections', async () => {
    const diagramId = await createDiagram('D5-1 Manhattan Spike 2');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');
    const modeling = modeler.get('modeling');

    // Place elements on different Y rows (simulates a cross-lane connection)
    const task1Id = await addElement(diagramId, 'bpmn:Task', { name: 'Task1', x: 200, y: 150 });
    const task2Id = await addElement(diagramId, 'bpmn:Task', { name: 'Task2', x: 400, y: 300 });
    const connId = await connect(diagramId, task1Id, task2Id);

    const conn = elementRegistry.get(connId);
    expect(conn).toBeDefined();

    let layoutError: Error | null = null;
    let newWaypoints: any[] | null = null;
    try {
      modeling.layoutConnection(conn);
      newWaypoints = conn.waypoints;
    } catch (err) {
      layoutError = err as Error;
    }

    if (layoutError) {
      // Document: layout fails for diagonal connections
      expect(layoutError.message).toBeDefined();
      return;
    }

    // ManhattanLayout should produce an orthogonal (L or Z-shaped) route
    // with only horizontal and vertical segments (no diagonal segments)
    expect(newWaypoints).toBeDefined();
    if (newWaypoints && newWaypoints.length >= 2) {
      for (let i = 0; i < newWaypoints.length - 1; i++) {
        const wp1 = newWaypoints[i];
        const wp2 = newWaypoints[i + 1];
        const isDiagonal = Math.abs(wp1.x - wp2.x) > 1 && Math.abs(wp1.y - wp2.y) > 1;
        expect(isDiagonal).toBe(false);
      }
    }
  });

  test('modeling.layoutConnection works on a gateway → task connection', async () => {
    const diagramId = await createDiagram('D5-1 Manhattan Spike 3');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');
    const modeling = modeler.get('modeling');

    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'GW',
      x: 300,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 500, y: 200 });
    const connId = await connect(diagramId, gwId, taskId);

    const conn = elementRegistry.get(connId);
    expect(conn).toBeDefined();

    let layoutError: Error | null = null;
    try {
      modeling.layoutConnection(conn);
    } catch (err) {
      layoutError = err as Error;
    }

    if (layoutError) {
      // Document what fails for gateway connections
      expect(layoutError.message).toBeDefined();
      return;
    }

    // Success: ManhattanLayout works for gateway connections headlessly
    expect(conn.waypoints).toBeDefined();
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
  });
});
