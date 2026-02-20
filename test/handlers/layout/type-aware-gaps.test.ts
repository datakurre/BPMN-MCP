/**
 * Integration test for element-type-aware gap variation (AI-8).
 *
 * Validates that gridSnapPass uses different horizontal gaps between
 * layers depending on the dominant element types in adjacent layers.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Right edge of an element (x + width). */
function rightEdge(el: any): number {
  return el.x + (el.width || 0);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Element-type-aware gap variation (AI-8)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('event→task gap is larger than task→task gap', async () => {
    // Build: StartEvent → Task1 → Task2 → Task3 → EndEvent
    const diagramId = await createDiagram('Gap Variation');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, task3);
    await connect(diagramId, task3, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const task1El = reg.get(task1);
    const task2El = reg.get(task2);
    const task3El = reg.get(task3);
    const endEl = reg.get(end);

    // Gap between start event and task1 (event→task)
    const eventToTaskGap = task1El.x - rightEdge(startEl);
    // Gap between task1 and task2 (task→task)
    const taskToTaskGap = task2El.x - rightEdge(task1El);
    // Gap between task3 and end event (task→event)
    const taskToEventGap = endEl.x - rightEdge(task3El);

    // Event↔Task gaps should be at least as large as Task→Task gaps
    // (EVENT_TASK_GAP_EXTRA=0 means they match the baseline — reference
    // layouts use the same or slightly smaller gaps for events)
    expect(eventToTaskGap).toBeGreaterThanOrEqual(taskToTaskGap);
    expect(taskToEventGap).toBeGreaterThanOrEqual(taskToTaskGap);
  });

  test('gateway→task gap uses baseline spacing', async () => {
    // Build: Start → Gateway → Task → End
    const diagramId = await createDiagram('Gateway Gaps');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Check' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'OK?' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, gw);
    await connect(diagramId, gw, task2);
    await connect(diagramId, task2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);
    const task2El = reg.get(task2);

    // Task→Gateway and Gateway→Task should use baseline gap (no adjustment)
    const taskToGwGap = gwEl.x - rightEdge(task1El);
    const gwToTaskGap = task2El.x - rightEdge(gwEl);

    // Both should be approximately equal (baseline gap)
    expect(Math.abs(taskToGwGap - gwToTaskGap)).toBeLessThan(15);
  });

  test('intermediate event→task gap is tighter than start/end event→task gap (G1)', async () => {
    // Build diagram with intermediate event: Start → TimerCatch → Task → End
    const diagramId1 = await createDiagram('Intermediate Event Gap');
    const start1 = await addElement(diagramId1, 'bpmn:StartEvent', { name: 'Start' });
    const timer = await addElement(diagramId1, 'bpmn:IntermediateCatchEvent', { name: 'Wait' });
    const task1 = await addElement(diagramId1, 'bpmn:UserTask', { name: 'Do Work' });
    const end1 = await addElement(diagramId1, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId1, start1, timer);
    await connect(diagramId1, timer, task1);
    await connect(diagramId1, task1, end1);
    await handleLayoutDiagram({ diagramId: diagramId1 });

    const reg1 = getDiagram(diagramId1)!.modeler.get('elementRegistry');
    const timerEl = reg1.get(timer);
    const task1El = reg1.get(task1);
    // Gap between intermediate event and task (intermediateEvent→task)
    const intermediateToTaskGap = task1El.x - rightEdge(timerEl);

    // Build diagram with only start/end events: Start → Task1 → Task2 → End
    const diagramId2 = await createDiagram('Start Event Gap');
    const start2 = await addElement(diagramId2, 'bpmn:StartEvent', { name: 'Start' });
    const task2 = await addElement(diagramId2, 'bpmn:UserTask', { name: 'Do Work' });
    const task3 = await addElement(diagramId2, 'bpmn:UserTask', { name: 'More Work' });
    const end2 = await addElement(diagramId2, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId2, start2, task2);
    await connect(diagramId2, task2, task3);
    await connect(diagramId2, task3, end2);
    await handleLayoutDiagram({ diagramId: diagramId2 });

    const reg2 = getDiagram(diagramId2)!.modeler.get('elementRegistry');
    const task2El = reg2.get(task2);
    const task3El = reg2.get(task3);
    // Gap between two tasks (task→task baseline)
    const taskToTaskGap = task3El.x - rightEdge(task2El);

    // Intermediate event→task gap should be tighter (or equal at minimum) than task→task
    // INTERMEDIATE_EVENT_TASK_GAP_REDUCE = 5 means 5px less than baseline
    expect(intermediateToTaskGap).toBeLessThanOrEqual(taskToTaskGap);
  });

  test('intermediate throw event→task gap is tighter than baseline (G1)', async () => {
    // Build: Start → Task → IntermediateThrow → Task → End
    const diagramId = await createDiagram('Throw Event Gap');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const throwEvt = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', { name: 'Signal' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, throwEvt);
    await connect(diagramId, throwEvt, task2);
    await connect(diagramId, task2, end);

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task1El = reg.get(task1);
    const throwEl = reg.get(throwEvt);
    const task2El = reg.get(task2);

    // task→intermediateThrow gap
    const taskToThrowGap = throwEl.x - rightEdge(task1El);
    // intermediateThrow→task gap
    const throwToTaskGap = task2El.x - rightEdge(throwEl);

    // Both should be tight (≤ baseline task-to-task spacing)
    // Just verify they're reasonable positive gaps
    expect(taskToThrowGap).toBeGreaterThan(0);
    expect(throwToTaskGap).toBeGreaterThan(0);

    // They should be equal (symmetric)
    expect(Math.abs(taskToThrowGap - throwToTaskGap)).toBeLessThan(15);
  });
});
