/**
 * Tests for moving boundary events.
 *
 * Covers the fix for the headless path-intersection crash that occurred
 * when moveElements was called on a boundary event with connections.
 * The crash was: "Cannot read properties of null (reading 'length')"
 * in isPathCurve → pathToCurve → findPathIntersections, triggered by
 * LabelLink's shape.changed handler processing null SVG path data.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleMoveElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('move boundary events', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('moves a boundary event without connections', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: taskId,
    });

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: beId, x: 320, y: 280 })
    );
    expect(res.success).toBe(true);
  });

  test('moves a boundary event with outgoing connection', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timeout', x: 500, y: 350 });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: taskId,
    });
    await connect(diagramId, beId, endId);

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: beId, x: 320, y: 280 })
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain(beId);
  });

  test('moves a boundary event in a connected workflow', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 200,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review', x: 400, y: 200 });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done', x: 600, y: 200 });
    const errorEndId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Error',
      x: 400,
      y: 400,
    });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: taskId,
    });

    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);
    await connect(diagramId, beId, errorEndId);

    const res = parseResult(
      await handleMoveElement({ diagramId, elementId: beId, x: 420, y: 280 })
    );
    expect(res.success).toBe(true);
  });
});
