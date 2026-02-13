import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleHandoffToLane,
  handleCreateCollaboration,
  handleAddElement,
  handleCreateLanes,
  handleListElements,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('handoff_bpmn_to_lane', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates element in target lane and connects via sequence flow', async () => {
    const diagramId = await createDiagram();

    // Create collaboration with one pool
    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process', height: 400 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const participantId = collabRes.participantIds[0];

    // Create lanes in the main pool
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Requester' }, { name: 'Approver' }],
      })
    );
    const requesterLaneId = lanesRes.laneIds[0];
    const approverLaneId = lanesRes.laneIds[1];

    // Add a task in the Requester lane
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit Request',
        participantId,
        laneId: requesterLaneId,
      })
    );
    const fromId = taskRes.elementId;

    // Handoff to Approver lane
    const res = parseResult(
      await handleHandoffToLane({
        diagramId,
        fromElementId: fromId,
        toLaneId: approverLaneId,
        name: 'Approve Request',
        connectionLabel: 'Submit for approval',
      })
    );

    expect(res.success).toBe(true);
    expect(res.createdElementId).toBeDefined();
    expect(res.connectionId).toBeDefined();
    expect(res.crossPool).toBe(false);
    expect(res.connectionType).toBe('bpmn:SequenceFlow');
  });

  test('defaults to UserTask element type', async () => {
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', height: 400 },
          { name: 'Partner', collapsed: true },
        ],
      })
    );
    const participantId = collabRes.participantIds[0];

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );

    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Data',
        participantId,
        laneId: lanesRes.laneIds[0],
      })
    );

    const res = parseResult(
      await handleHandoffToLane({
        diagramId,
        fromElementId: taskRes.elementId,
        toLaneId: lanesRes.laneIds[1],
        name: 'Review Data',
      })
    );

    expect(res.success).toBe(true);
    expect(res.createdElementId).toBeDefined();

    // Verify the created element is a UserTask
    const elements = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:UserTask',
        namePattern: 'Review Data',
      })
    );
    expect(elements.elements.length).toBeGreaterThan(0);
  });

  test('rejects invalid element type', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleHandoffToLane({
        diagramId,
        fromElementId: 'nonexistent',
        toLaneId: 'nonexistent',
        elementType: 'bpmn:Participant',
      })
    ).rejects.toThrow();
  });

  test('rejects non-lane target', async () => {
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Process' }, { name: 'Partner', collapsed: true }],
      })
    );

    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task',
        participantId: collabRes.participantIds[0],
      })
    );

    // Try to handoff to a participant (not a lane)
    await expect(
      handleHandoffToLane({
        diagramId,
        fromElementId: taskRes.elementId,
        toLaneId: collabRes.participantIds[0],
      })
    ).rejects.toThrow(/bpmn:Lane/);
  });

  test('supports custom element type', async () => {
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', height: 400 },
          { name: 'Partner', collapsed: true },
        ],
      })
    );
    const participantId = collabRes.participantIds[0];

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Manual' }, { name: 'Auto' }],
      })
    );

    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Manual Step',
        participantId,
        laneId: lanesRes.laneIds[0],
      })
    );

    const res = parseResult(
      await handleHandoffToLane({
        diagramId,
        fromElementId: taskRes.elementId,
        toLaneId: lanesRes.laneIds[1],
        elementType: 'bpmn:ServiceTask',
        name: 'Auto Process',
      })
    );

    expect(res.success).toBe(true);

    // Verify the created element is a ServiceTask
    const elements = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        namePattern: 'Auto Process',
      })
    );
    expect(elements.elements.length).toBeGreaterThan(0);
  });
});
