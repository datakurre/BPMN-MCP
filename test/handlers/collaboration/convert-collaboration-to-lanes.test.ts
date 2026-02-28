import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
  handleConvertCollaborationToLanes,
  handleListElements,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams, getRegistry } from '../../helpers';

describe('convert_bpmn_collaboration_to_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('converts a two-pool collaboration into a single pool with lanes', async () => {
    const diagramId = await createDiagram();

    // Create collaboration with two expanded pools
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Support' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Add elements to first pool
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Request',
        participantId: pool1Id,
      })
    ).elementId;

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit Request',
        participantId: pool1Id,
      })
    ).elementId;

    await handleConnect({
      diagramId,
      sourceElementId: start,
      targetElementId: task1,
    });

    // Add elements to second pool
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Request',
        participantId: pool2Id,
      })
    ).elementId;

    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: pool2Id,
      })
    ).elementId;

    await handleConnect({
      diagramId,
      sourceElementId: task2,
      targetElementId: end,
    });

    // Convert to lanes
    const result = parseResult(
      await handleConvertCollaborationToLanes({
        diagramId,
        layout: false,
      })
    );

    expect(result.success).toBe(true);
    expect(result.laneNames).toHaveLength(2);
    expect(result.laneNames).toContain('Customer');
    expect(result.laneNames).toContain('Support');
    expect(result.removedPools).toHaveLength(1);
  });

  test('rejects when fewer than 2 participants exist', async () => {
    const diagramId = await createDiagram();

    await expect(handleConvertCollaborationToLanes({ diagramId })).rejects.toThrow(
      /at least 2 participants/
    );
  });

  test('allows specifying the main participant', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Pool A' }, { name: 'Pool B' }],
      })
    );

    const poolAId = collab.participantIds[0];

    // Add an element to Pool A
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task in A',
      participantId: poolAId,
    });

    const result = parseResult(
      await handleConvertCollaborationToLanes({
        diagramId,
        mainParticipantId: poolAId,
        layout: false,
      })
    );

    expect(result.success).toBe(true);
    expect(result.mainParticipantName).toBe('Pool A');
  });

  test('converts message flows to sequence flows', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Sender' }, { name: 'Receiver' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Add elements
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send Message',
        participantId: pool1Id,
      })
    ).elementId;

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ReceiveTask',
        name: 'Receive Message',
        participantId: pool2Id,
      })
    ).elementId;

    // Create message flow
    await handleConnect({
      diagramId,
      sourceElementId: task1,
      targetElementId: task2,
    });

    const result = parseResult(
      await handleConvertCollaborationToLanes({
        diagramId,
        layout: false,
      })
    );

    expect(result.success).toBe(true);
    expect(result.convertedMessageFlows).toBe(1);
    expect(result.createdSequenceFlows).toBeGreaterThanOrEqual(1);

    // Verify no message flows remain
    const elements = parseResult(
      await handleListElements({
        diagramId,
        elementType: 'bpmn:MessageFlow',
      })
    );
    expect(elements.elements).toHaveLength(0);
  });

  test('keeps collapsed pools untouched', async () => {
    const diagramId = await createDiagram();

    const _collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Main Process' },
          { name: 'Internal Role' },
          { name: 'External API', collapsed: true },
        ],
      })
    );

    // Two expanded + one collapsed: should merge the two expanded
    const result = parseResult(
      await handleConvertCollaborationToLanes({
        diagramId,
        layout: false,
      })
    );

    expect(result.success).toBe(true);
    expect(result.laneNames).toHaveLength(2);
    expect(result.laneNames).toContain('Main Process');
    expect(result.laneNames).toContain('Internal Role');
  });

  test('all elements have non-negative Y coordinates after conversion without layout', async () => {
    // Regression for TODO #2: normaliseOrigin not called after convert
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Support' }],
      })
    );

    const pool1Id = collab.participantIds[0];
    const pool2Id = collab.participantIds[1];

    // Add elements to both pools
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
      participantId: pool1Id,
    });
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Handle Request',
      participantId: pool2Id,
    });

    // Convert without layout
    const result = parseResult(
      await handleConvertCollaborationToLanes({
        diagramId,
        layout: false,
      })
    );

    expect(result.success).toBe(true);

    // All flow elements and the participant must have Y >= 0
    const reg = getRegistry(diagramId);
    const allElements: any[] = reg.getAll();
    for (const el of allElements) {
      if (el.y !== undefined && el.type !== 'label') {
        expect(el.y, `Element ${el.id} (${el.type}) has y=${el.y} < 0`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('does not create a lane for an empty source pool (TODO #6 second sub)', async () => {
    // 3-pool collaboration: "Customer" (with elements), "Support" (with elements), "Operations" (empty)
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer' },
          { name: 'Support' },
          { name: 'Operations' }, // intentionally left empty
        ],
      })
    );

    const customerId = collab.participantIds[0];
    const supportId = collab.participantIds[1];
    // operationsId = collab.participantIds[2] — left empty

    // Add elements to Customer pool
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        participantId: customerId,
      })
    ).elementId;
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Place Order',
        participantId: customerId,
      })
    ).elementId;
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task1 });

    // Add elements to Support pool
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Handle Support',
        participantId: supportId,
      })
    ).elementId;
    const end = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', participantId: supportId })
    ).elementId;
    await handleConnect({ diagramId, sourceElementId: task2, targetElementId: end });

    // Convert to lanes — Operations pool is empty so its lane should NOT be created
    const result = parseResult(
      await handleConvertCollaborationToLanes({ diagramId, layout: false })
    );

    expect(result.success).toBe(true);
    // Only 2 lanes: Customer and Support — Operations (empty) is skipped
    expect(result.laneNames).toHaveLength(2);
    expect(result.laneNames).toContain('Customer');
    expect(result.laneNames).toContain('Support');
    expect(result.laneNames).not.toContain('Operations');
  });
});
