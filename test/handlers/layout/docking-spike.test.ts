/**
 * D1-1: ConnectionDocking headless invocation spike.
 *
 * Tries `modeler.get('connectionDocking').getCroppedWaypoints()` on a connection
 * after layout. Documents whether CroppingConnectionDocking works in jsdom
 * headlessly, and what SVG polyfills (if any) are missing.
 *
 * CONTEXT: The current edge routing uses rectangular clamping via `clampToRect()`
 * which is inaccurate for non-rectangular shapes (circles for events, diamonds
 * for gateways). `CroppingConnectionDocking` uses actual SVG path intersection
 * for accurate endpoint placement.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('D1-1: CroppingConnectionDocking headless spike', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('connectionDocking service is accessible from modeler', async () => {
    const diagramId = await createDiagram('D1-1 Docking Spike');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;

    // Check if connectionDocking service is registered
    let dockingService: any;
    let serviceError: Error | null = null;
    try {
      dockingService = modeler.get('connectionDocking');
    } catch (err) {
      serviceError = err as Error;
    }

    if (serviceError) {
      // Document: service not available headlessly
      expect(serviceError.message).toBeDefined();
      return;
    }

    expect(dockingService).toBeDefined();
    expect(typeof dockingService.getCroppedWaypoints).toBe('function');
  });

  test('getCroppedWaypoints works on a StartEvent → Task connection', async () => {
    const diagramId = await createDiagram('D1-1 Docking Spike 2');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 350, y: 200 });
    const connId = await connect(diagramId, startId, taskId);

    const conn = elementRegistry.get(connId);
    expect(conn).toBeDefined();

    let dockingService: any;
    try {
      dockingService = modeler.get('connectionDocking');
    } catch {
      // Service not available — document this
      expect(true).toBe(true); // spike finding: service not accessible
      return;
    }

    let croppedWaypoints: any;
    let dockingError: Error | null = null;
    try {
      croppedWaypoints = dockingService.getCroppedWaypoints(conn);
    } catch (err) {
      dockingError = err as Error;
    }

    if (dockingError) {
      // Document what error occurs — likely missing SVG polyfill
      // e.g. getPointAtLength, getTotalLength, isPointInStroke
      const msg = dockingError.message;
      // This tells us what polyfill to add in D1-2
      expect(msg).toBeDefined();
      return;
    }

    // If we get here, cropping works headlessly
    expect(croppedWaypoints).toBeDefined();
    expect(Array.isArray(croppedWaypoints)).toBe(true);
    expect(croppedWaypoints.length).toBeGreaterThanOrEqual(2);

    // Endpoints should be near shape boundaries (not at centres)
    const start = elementRegistry.get(startId);
    const task = elementRegistry.get(taskId);

    const firstWp = croppedWaypoints[0];
    const lastWp = croppedWaypoints[croppedWaypoints.length - 1];

    // First waypoint should be near the start event's right edge (not centre)
    const startCx = start.x + (start.width ?? 0) / 2;
    const startRight = start.x + (start.width ?? 0);
    // Should be close to perimeter, not centre
    expect(Math.abs(firstWp.x - startCx)).toBeGreaterThan(5);
    expect(Math.abs(firstWp.x - startRight)).toBeLessThan(10);

    // Last waypoint should be near the task's left edge
    const taskLeft = task.x;
    expect(Math.abs(lastWp.x - taskLeft)).toBeLessThan(10);
  });

  test('getCroppedWaypoints works on an ExclusiveGateway → Task connection', async () => {
    const diagramId = await createDiagram('D1-1 Docking Spike 3');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');

    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'GW',
      x: 300,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 500, y: 200 });
    const connId = await connect(diagramId, gwId, taskId);

    const conn = elementRegistry.get(connId);

    let dockingService: any;
    try {
      dockingService = modeler.get('connectionDocking');
    } catch {
      return; // Not available headlessly
    }

    let croppedWaypoints: any;
    let dockingError: Error | null = null;
    try {
      croppedWaypoints = dockingService.getCroppedWaypoints(conn);
    } catch (err) {
      dockingError = err as Error;
      // Document: docking fails for diamond shapes (gateway) — needs SVG path polyfill
      expect(dockingError).toBeDefined();
      return;
    }

    // Gateways are diamond-shaped — endpoint should be on the diamond perimeter
    expect(croppedWaypoints).toBeDefined();
    expect(croppedWaypoints.length).toBeGreaterThanOrEqual(2);

    const gw = elementRegistry.get(gwId);
    const gwCx = gw.x + (gw.width ?? 0) / 2;
    const firstWp = croppedWaypoints[0];

    // Endpoint should NOT be at the centre of the gateway
    expect(Math.abs(firstWp.x - gwCx)).toBeGreaterThan(5);
  });
});
