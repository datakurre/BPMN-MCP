import { describe, test, expect, beforeEach } from 'vitest';
import { handleAssignElementsToLane, handleCreateLanes } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('assign_bpmn_elements_to_lane', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  async function createPoolWithLanes(diagramId: string) {
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Pool',
      x: 300,
      y: 300,
    });
    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    return { participant, laneIds: lanesResult.laneIds as string[] };
  }

  test('assigns elements to a lane', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
    expect(res.assignedElementIds).toContain(task);
  });

  test('assigns multiple elements', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[1],
        elementIds: [t1, t2],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(2);
  });

  test('skips non-existent elements', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task, 'nonexistent_element'],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reason).toContain('not found');
  });

  test('rejects non-lane target', async () => {
    const diagramId = await createDiagram();
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });

    await expect(
      handleAssignElementsToLane({
        diagramId,
        laneId: task,
        elementIds: [task2],
      })
    ).rejects.toThrow(/bpmn:Lane/);
  });

  test('supports reposition=false to keep positions', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task],
        reposition: false,
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
  });

  test('skips boundary events and suggests assigning host instead', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const be = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: task,
    });

    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [be],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].elementId).toBe(be);
    expect(res.skipped[0].reason).toContain('host task');
  });

  test('auto-assigns boundary events when host task is assigned', async () => {
    const diagramId = await createDiagram();
    const { laneIds } = await createPoolWithLanes(diagramId);
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task', x: 300, y: 200 });
    const be = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Timer',
      hostElementId: task,
    });

    // Assign the host task — boundary event should follow automatically
    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneIds[0],
        elementIds: [task],
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedCount).toBe(1);
    expect(res.assignedElementIds).toContain(task);

    // Check that the boundary event's BO was added to the lane's flowNodeRef
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const laneEl = reg.get(laneIds[0]);
    const laneRefs = laneEl.businessObject?.flowNodeRef || [];
    const beEl = reg.get(be);
    expect(laneRefs).toContain(beEl.businessObject);
  });
});
