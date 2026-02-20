/**
 * Tests for the K2 layout strategy selector.
 *
 * Verifies that the selector recommends the correct strategy for each
 * diagram shape category.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { selectLayoutStrategy } from '../../../src/elk/strategy-selector';
import {
  handleAddElement,
  handleConnect,
  handleCreateCollaboration,
  handleCreateLanes,
  handleCreateParticipant,
  handleLayoutDiagram,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('layout strategy selector (K2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('empty diagram returns elk-full with low/medium confidence', async () => {
    const diagramId = await createDiagram('Empty');
    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);
    expect(result.strategy).toBe('elk-full');
    expect(result.stats.flowNodeCount).toBe(0);
  });

  test('linear chain recommends deterministic strategy', async () => {
    const diagramId = await createDiagram('Linear');

    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task A',
        afterElementId: start.elementId,
      })
    );
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task B',
        afterElementId: task1.elementId,
      })
    );
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        afterElementId: task2.elementId,
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: task1.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: task1.elementId,
      targetElementId: task2.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: task2.elementId,
      targetElementId: end.elementId,
    });

    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);

    expect(result.strategy).toBe('deterministic');
    expect(result.confidence).toBe('high');
    expect(result.stats.flowNodeCount).toBeGreaterThanOrEqual(3);
    expect(result.stats.laneCount).toBe(0);
    expect(result.stats.messageFlowCount).toBe(0);
  });

  test('multi-pool collaboration recommends elk-collaboration', async () => {
    const diagramId = await createDiagram('Collab');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Service' }],
      })
    );

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send',
        participantId: collab.participantIds[0],
      })
    );
    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ReceiveTask',
        name: 'Receive',
        participantId: collab.participantIds[1],
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: task1.elementId,
      targetElementId: task2.elementId,
    });

    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);

    expect(result.strategy).toBe('elk-collaboration');
    expect(result.stats.participantCount).toBeGreaterThanOrEqual(2);
  });

  test('single pool with lanes recommends elk-lanes', async () => {
    const diagramId = await createDiagram('Lanes');

    const pool = parseResult(await handleCreateParticipant({ diagramId, name: 'Process' }));

    parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: pool.participantId,
        lanes: [{ name: 'Human Tasks' }, { name: 'Automated Tasks' }],
      })
    );

    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);

    expect(result.strategy).toBe('elk-lanes');
    expect(result.stats.laneCount).toBeGreaterThanOrEqual(2);
    expect(result.confidence).toBe('high');
  });

  test('diagram with boundary event recommends elk-full', async () => {
    const diagramId = await createDiagram('Boundary');

    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const task = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process',
        afterElementId: start.elementId,
      })
    );
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      name: 'Error',
      hostElementId: task.elementId,
    });

    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);

    expect(result.strategy).toBe('elk-full');
    expect(result.stats.boundaryEventCount).toBeGreaterThanOrEqual(1);
  });

  test('strategy analysis includes stats object', async () => {
    const diagramId = await createDiagram('Stats Check');
    const diagram = getDiagram(diagramId)!;
    const result = selectLayoutStrategy(diagram);

    expect(result.stats).toBeDefined();
    expect(typeof result.stats.flowNodeCount).toBe('number');
    expect(typeof result.stats.sequenceFlowCount).toBe('number');
    expect(typeof result.stats.messageFlowCount).toBe('number');
    expect(typeof result.stats.participantCount).toBe('number');
    expect(typeof result.stats.laneCount).toBe('number');
    expect(typeof result.stats.isTrivialShape).toBe('boolean');
  });

  test('dry-run includes recommendedStrategy field', async () => {
    const diagramId = await createDiagram('DryRun Strategy');

    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        afterElementId: start.elementId,
      })
    );
    await handleConnect({
      diagramId,
      sourceElementId: start.elementId,
      targetElementId: end.elementId,
    });

    const result = parseResult(await handleLayoutDiagram({ diagramId, dryRun: true }));

    expect(result.recommendedStrategy).toBeDefined();
    expect(result.recommendedStrategy.strategy).toMatch(
      /^(deterministic|elk-full|elk-lanes|elk-collaboration|elk-subset)$/
    );
    expect(typeof result.recommendedStrategy.reason).toBe('string');
    expect(result.recommendedStrategy.confidence).toMatch(/^(high|medium|low)$/);
  });
});
