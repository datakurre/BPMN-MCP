import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetConnectionWaypoints } from '../../../src/handlers/elements/set-connection-waypoints';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('set_bpmn_connection_waypoints', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets custom waypoints on a sequence flow', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 200 });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do something',
      x: 300,
      y: 200,
    });
    const flowId = await connect(diagramId, startId, taskId);

    const waypoints = [
      { x: 136, y: 218 },
      { x: 200, y: 300 },
      { x: 300, y: 240 },
    ];

    const res = parseResult(
      await handleSetConnectionWaypoints({
        diagramId,
        connectionId: flowId,
        waypoints,
      })
    );

    expect(res.success).toBe(true);
    expect(res.connectionId).toBe(flowId);
    expect(res.newWaypoints).toEqual(waypoints);
    expect(res.waypointCount).toBe(3);
    expect(res.previousWaypoints.length).toBeGreaterThanOrEqual(2);
  });

  test('rejects non-connection elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Not a flow',
      x: 100,
      y: 100,
    });

    const res = parseResult(
      await handleSetConnectionWaypoints({
        diagramId,
        connectionId: taskId,
        waypoints: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      })
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('not a connection');
  });

  test('rejects fewer than 2 waypoints', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 200 });
    const taskId = await addElement(diagramId, 'bpmn:Task', { x: 300, y: 200 });
    const flowId = await connect(diagramId, startId, taskId);

    const res = parseResult(
      await handleSetConnectionWaypoints({
        diagramId,
        connectionId: flowId,
        waypoints: [{ x: 100, y: 100 }],
      })
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('at least 2 points');
  });

  test('supports U-shaped loopback waypoints', async () => {
    const diagramId = await createDiagram();
    const task1Id = await addElement(diagramId, 'bpmn:Task', { name: 'First', x: 200, y: 200 });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Retry?',
      x: 400,
      y: 200,
    });
    // Create a loopback flow: gateway → task1
    const flowId = await connect(diagramId, gwId, task1Id);

    // U-shaped loopback: down, left, up
    const waypoints = [
      { x: 425, y: 225 },
      { x: 425, y: 350 },
      { x: 250, y: 350 },
      { x: 250, y: 225 },
    ];

    const res = parseResult(
      await handleSetConnectionWaypoints({
        diagramId,
        connectionId: flowId,
        waypoints,
      })
    );

    expect(res.success).toBe(true);
    expect(res.waypointCount).toBe(4);
    expect(res.newWaypoints).toEqual(waypoints);
  });
});
