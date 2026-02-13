/**
 * Tests for insert_bpmn_element tool.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleInsertElement } from '../../../src/handlers/elements/insert-element';
import { handleConnect } from '../../../src/handlers/elements/connect';
import { handleCreateLanes } from '../../../src/handlers';
import { clearDiagrams } from '../../../src/diagram-manager';
import { parseResult, createDiagram, addElement, getRegistry } from '../../helpers';

afterEach(() => clearDiagrams());

describe('insert_bpmn_element', () => {
  test('should insert an element into a sequence flow', async () => {
    const diagramId = await createDiagram('insert-test');

    // Build a simple flow: Start → End
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      x: 400,
      y: 100,
    });
    const connectResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    );
    const flowId = connectResult.connectionId;

    // Insert a UserTask between Start and End
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
      })
    );
    expect(insertResult.success).toBe(true);
    expect(insertResult.elementType).toBe('bpmn:UserTask');
    expect(insertResult.newFlows).toHaveLength(2);
    expect(insertResult.newFlows[0].source).toBe(startId);
    expect(insertResult.newFlows[1].target).toBe(endId);
  });

  test('should reject non-SequenceFlow elements', async () => {
    const diagramId = await createDiagram('insert-test-2');
    const startId = await addElement(diagramId, 'bpmn:StartEvent');

    await expect(
      handleInsertElement({
        diagramId,
        flowId: startId,
        elementType: 'bpmn:UserTask',
      })
    ).rejects.toThrow(/not a SequenceFlow/);
  });

  test('should reject non-insertable element types', async () => {
    const diagramId = await createDiagram('insert-test-3');
    const startId = await addElement(diagramId, 'bpmn:StartEvent');
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 400, y: 100 });
    const connectResult = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    );

    await expect(
      handleInsertElement({
        diagramId,
        flowId: connectResult.connectionId,
        elementType: 'bpmn:Participant',
      })
    ).rejects.toThrow(/Invalid elementType/);
  });

  test('should place element in specified lane when laneId is provided', async () => {
    const diagramId = await createDiagram('insert-lane-test');

    // Create a pool with two lanes
    const poolId = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Process',
      x: 400,
      y: 300,
    });

    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Author' }, { name: 'Reviewer' }],
      })
    );
    const authorLaneId = lanesResult.laneIds[0];
    const reviewerLaneId = lanesResult.laneIds[1];

    // Add elements in different lanes
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolId,
      laneId: authorLaneId,
      x: 200,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      participantId: poolId,
      laneId: reviewerLaneId,
      x: 600,
    });

    const flowId = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    ).connectionId;

    // Insert into the flow, specifying the author lane
    const insertResult = parseResult(
      await handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:UserTask',
        name: 'Write',
        laneId: authorLaneId,
      })
    );

    expect(insertResult.success).toBe(true);
    expect(insertResult.laneId).toBe(authorLaneId);

    // Verify the element is vertically near the author lane center
    const registry = getRegistry(diagramId);
    const authorLane = registry.get(authorLaneId);
    const inserted = registry.get(insertResult.elementId);
    const laneCenterY = authorLane.y + authorLane.height / 2;
    const elementCenterY = inserted.y + inserted.height / 2;
    expect(Math.abs(elementCenterY - laneCenterY)).toBeLessThan(60);
  });

  test('should reject invalid laneId type', async () => {
    const diagramId = await createDiagram('insert-lane-invalid');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 400, y: 100 });
    const flowId = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      })
    ).connectionId;

    await expect(
      handleInsertElement({
        diagramId,
        flowId,
        elementType: 'bpmn:UserTask',
        laneId: startId, // not a lane
      })
    ).rejects.toThrow(/requires.*Lane|bpmn:Lane/i);
  });
});
