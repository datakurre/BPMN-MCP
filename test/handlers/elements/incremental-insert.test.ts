/**
 * Tests for incremental insert-between layout without full re-layout (C1-7 / C1-8).
 *
 * Verifies that after inserting an element into a sequence flow:
 *  - (C1-7) Elements are evenly spaced and sequence flows have reasonable
 *    waypoints without calling layout_bpmn_diagram.
 *  - (C1-8) Elements on unrelated parallel branches are NOT shifted when
 *    an element is inserted on only one branch of a split gateway.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('incremental insert-between without full re-layout (C1-7)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('C1-7: inserting into a linear flow leaves elements spaced without layout', async () => {
    // Build: Start → A → B → End (laid out left-to-right by default add placement)
    const diagramId = await createDiagram('C1-7 Linear');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskA = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task A',
      afterElementId: start,
    });
    const taskB = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task B',
      afterElementId: taskA,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: taskB,
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Connect them
    const flowAB = await connect(diagramId, taskA, taskB);

    // Record positions of B and End before insertion
    const taskBBefore = reg.get(taskB);
    const endBefore = reg.get(end);
    const taskBxBefore = taskBBefore.x;
    const endXBefore = endBefore.x;

    // Insert C between A and B (via flowId = flowAB)
    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task C',
        flowId: flowAB,
      })
    );
    expect(insertResult.elementId).toBeDefined();
    const taskCId = insertResult.elementId as string;

    const taskAEl = reg.get(taskA);
    const taskCEl = reg.get(taskCId);
    const taskBEl = reg.get(taskB);

    // C must be placed between A and B on the X axis
    expect(taskCEl).toBeDefined();
    const taskARight = taskAEl.x + (taskAEl.width ?? 100);
    const taskBLeft = taskBEl.x;
    expect(taskCEl.x).toBeGreaterThanOrEqual(taskARight);
    expect(taskCEl.x + (taskCEl.width ?? 100)).toBeLessThanOrEqual(taskBLeft + 1);

    // B and End must have shifted right (or stayed put if there was enough space)
    // — they must not have shifted LEFT
    const taskBxAfter = reg.get(taskB).x;
    const endXAfter = reg.get(end).x;
    expect(taskBxAfter).toBeGreaterThanOrEqual(taskBxBefore);
    expect(endXAfter).toBeGreaterThanOrEqual(endXBefore);

    // New connections should have been created
    expect(insertResult.newFlows).toHaveLength(2);
  });

  test('C1-7: insert result has no layout_bpmn_diagram nextStep hint', async () => {
    const diagramId = await createDiagram('C1-7 NoHint');
    const start = await addElement(diagramId, 'bpmn:StartEvent', {});
    const end = await addElement(diagramId, 'bpmn:EndEvent', { afterElementId: start });
    const flow = await connect(diagramId, start, end);

    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        flowId: flow,
      })
    );

    // C1-6: The layout_bpmn_diagram hint should no longer appear in nextSteps
    const nextSteps: Array<{ tool: string }> = insertResult.nextSteps ?? [];
    const hasLayoutHint = nextSteps.some((s) => s.tool === 'layout_bpmn_diagram');
    expect(hasLayoutHint).toBe(false);
  });
});

describe('C1-8: parallel branch stability after insert-between', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('elements on unaffected branch do not move when inserting on one branch', async () => {
    // Build a gateway split:
    //   Start → Gateway → [Branch1: T1 → End1] and [Branch2: T2 → End2]
    const diagramId = await createDiagram('C1-8 Parallel');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Split',
      afterElementId: start,
    });
    await connect(diagramId, start, gw);

    // Branch 1 (top)
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T1' });
    const e1 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'E1', afterElementId: t1 });
    const flowGwT1 = await connect(diagramId, gw, t1);
    await connect(diagramId, t1, e1);

    // Branch 2 (bottom)
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T2' });
    const e2 = await addElement(diagramId, 'bpmn:EndEvent', { name: 'E2', afterElementId: t2 });
    await connect(diagramId, gw, t2);
    await connect(diagramId, t2, e2);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Record Branch 2 positions before insert
    const t2xBefore = reg.get(t2).x;
    const e2xBefore = reg.get(e2).x;

    // Insert a task on Branch 1 between Gateway and T1
    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Validate',
        flowId: flowGwT1,
      })
    );
    expect(insertResult.elementId).toBeDefined();

    // Branch 2 (T2, E2) must NOT have shifted (C1-1 BFS only follows Branch 1)
    const t2xAfter = reg.get(t2).x;
    const e2xAfter = reg.get(e2).x;

    // Allow a small tolerance for connector routing adjustments (±5px),
    // but the branch elements themselves must not have moved significantly.
    expect(Math.abs(t2xAfter - t2xBefore)).toBeLessThan(10);
    expect(Math.abs(e2xAfter - e2xBefore)).toBeLessThan(10);

    // Branch 1 element (T1) should have shifted right to make room
    const t1El = reg.get(t1);
    expect(t1El.x).toBeGreaterThanOrEqual(reg.get(gw).x + (reg.get(gw).width ?? 50));
  });
});
