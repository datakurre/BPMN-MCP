import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleSplitParticipantIntoLanes,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('split_bpmn_participant_into_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('splits participant by task type', async () => {
    const diagramId = await createDiagram();

    // Create a collaboration with one pool
    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'My Process' }, { name: 'External', collapsed: true }],
      })
    );
    const participantId = collabRes.participantIds[0];

    // Add a user task and a service task
    const userTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Request',
        participantId,
      })
    );
    const serviceTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Email',
        participantId,
      })
    );

    // Split into lanes
    const res = parseResult(
      await handleSplitParticipantIntoLanes({
        diagramId,
        participantId,
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneIds).toHaveLength(2);
    expect(res.strategy).toBe('by-type');
    // Check that assignments exist and include our elements
    const allAssigned = Object.values(res.assignments).flat();
    expect(allAssigned).toContain(userTask.elementId);
    expect(allAssigned).toContain(serviceTask.elementId);
  });

  test('splits participant with manual strategy', async () => {
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'My Process' }, { name: 'External', collapsed: true }],
      })
    );
    const participantId = collabRes.participantIds[0];

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
        participantId,
      })
    );
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task B',
        participantId,
      })
    );

    const res = parseResult(
      await handleSplitParticipantIntoLanes({
        diagramId,
        participantId,
        strategy: 'manual',
        lanes: [
          { name: 'Approvers', elementIds: [task1.elementId] },
          { name: 'Workers', elementIds: [task2.elementId] },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneIds).toHaveLength(2);
    expect(res.laneNames).toEqual(['Approvers', 'Workers']);
  });

  test('rejects participant that already has lanes', async () => {
    const diagramId = await createDiagram();

    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          {
            name: 'My Process',
            lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
          },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const participantId = collabRes.participantIds[0];

    await expect(
      handleSplitParticipantIntoLanes({
        diagramId,
        participantId,
      })
    ).rejects.toThrow(/already has/);
  });
});
