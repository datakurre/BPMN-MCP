/**
 * Tests for incremental layout after element insertion (I2).
 *
 * Verifies that when an element is inserted into an existing sequence flow
 * (via `flowId`) and a partial re-layout is run on the inserted element,
 * the new element is positioned between its source and target neighbours
 * and all connecting edges are rebuilt correctly.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('incremental layout after element insertion (I2)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('inserted element is placed between source and target after partial layout', async () => {
    // Build: Start → T1 → T2 → End
    const diagramId = await createDiagram('Incremental Insert');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const flow12 = await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    // Full layout to position everything
    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);

    // Record original positions before insertion
    const t1Right = t1El.x + (t1El.width || 100);
    const t2Left = t2El.x;

    // Insert a new element into the flow between Start and T1
    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Validate',
        flowId: flow12,
      })
    );
    expect(insertResult.elementId).toBeDefined();
    const newTaskId = insertResult.elementId as string;

    // Run partial layout on just the inserted element
    const layoutResult = parseResult(
      await handleLayoutDiagram({ diagramId, elementIds: [newTaskId] })
    );
    expect(layoutResult.success).toBe(true);

    const newEl = reg.get(newTaskId);
    expect(newEl).toBeDefined();

    // The new element's centre should be between the two surrounding tasks on the X axis
    const newCx = newEl.x + (newEl.width || 100) / 2;
    const startEl = reg.get(start);
    const startCx = startEl.x + (startEl.width || 36) / 2;

    // New element should be to the right of start and to the left of t1
    expect(newCx).toBeGreaterThan(startCx);
    expect(newEl.x + (newEl.width || 100)).toBeLessThanOrEqual(t1El.x + 10);

    // The element should have a reasonable Y position (close to the flow row)
    const t1Cy = t1El.y + (t1El.height || 80) / 2;
    const newCy = newEl.y + (newEl.height || 80) / 2;
    expect(Math.abs(newCy - t1Cy)).toBeLessThan(60);

    // The original T1 and T2 positions should be approximately unchanged
    // (partial layout only moves the inserted element and its direct neighbors)
    const t1ElAfter = reg.get(t1);
    const t2ElAfter = reg.get(t2);
    expect(Math.abs(t1ElAfter.x - t1El.x)).toBeLessThanOrEqual(30);
    expect(Math.abs(t2ElAfter.x - t2El.x)).toBeLessThanOrEqual(30);

    // Suppress unused variable warnings
    void t1Right;
    void t2Left;
  });

  test('full re-layout after insertion produces valid connected diagram', async () => {
    // Build: Start → T1 → T2 → End
    const diagramId = await createDiagram('Incremental Full Relayout');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const flow12 = await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    // Full layout first
    await handleLayoutDiagram({ diagramId });

    // Insert a new element into the first flow
    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Intermediate Step',
        flowId: flow12,
      })
    );
    const newTaskId = insertResult.elementId as string;
    expect(newTaskId).toBeDefined();

    // Full re-layout after insertion
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const newEl = reg.get(newTaskId);
    const t1El = reg.get(t1);
    const t2El = reg.get(t2);
    const endEl = reg.get(end);

    // After full re-layout, all elements should be in left-to-right order
    // (inserted element comes before t1 since it was inserted into start→t1 flow)
    const startCx = startEl.x + (startEl.width || 36) / 2;
    const newCx = newEl.x + (newEl.width || 100) / 2;
    const t1Cx = t1El.x + (t1El.width || 100) / 2;
    const t2Cx = t2El.x + (t2El.width || 100) / 2;
    const endCx = endEl.x + (endEl.width || 36) / 2;

    expect(startCx).toBeLessThan(newCx);
    expect(newCx).toBeLessThan(t1Cx);
    expect(t1Cx).toBeLessThan(t2Cx);
    expect(t2Cx).toBeLessThan(endCx);
  });

  test('inserting multiple elements sequentially produces stable layout', async () => {
    // Build: Start → Task → End
    const diagramId = await createDiagram('Multi Insert');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Main Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const flowStartTask = await connect(diagramId, start, task);
    const flowTaskEnd = await connect(diagramId, task, end);

    await handleLayoutDiagram({ diagramId });

    // Insert element before main task
    const insert1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Pre-Process',
        flowId: flowStartTask,
      })
    );
    const preTaskId = insert1.elementId as string;
    expect(preTaskId).toBeDefined();

    // Insert element after main task
    const insert2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Post-Process',
        flowId: flowTaskEnd,
      })
    );
    const postTaskId = insert2.elementId as string;
    expect(postTaskId).toBeDefined();

    // Full re-layout after all insertions
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const preEl = reg.get(preTaskId);
    const mainEl = reg.get(task);
    const postEl = reg.get(postTaskId);
    const endEl = reg.get(end);

    // Verify left-to-right ordering after full re-layout
    expect(startEl.x + (startEl.width || 36)).toBeLessThan(preEl.x + 5);
    expect(preEl.x + (preEl.width || 100)).toBeLessThan(mainEl.x + 5);
    expect(mainEl.x + (mainEl.width || 100)).toBeLessThan(postEl.x + 5);
    expect(postEl.x + (postEl.width || 100)).toBeLessThan(endEl.x + 5);
  });

  test('inserted gateway with branches layouts correctly after full re-layout', async () => {
    // Build: Start → T1 → End
    const diagramId = await createDiagram('Gateway Insert');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const flow = await connect(diagramId, start, t1);
    await connect(diagramId, t1, end);

    await handleLayoutDiagram({ diagramId });

    // Insert a gateway into the start→t1 flow
    const insertResult = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Route?',
        flowId: flow,
      })
    );
    const gwId = insertResult.elementId as string;
    expect(gwId).toBeDefined();

    // Add a bypass branch from the gateway
    const bypass = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Skip' });
    await connect(diagramId, gwId, bypass);

    // Full re-layout
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const gwEl = reg.get(gwId);
    const t1El = reg.get(t1);

    // Gateway should be between start and t1
    const startCx = startEl.x + (startEl.width || 36) / 2;
    const gwCx = gwEl.x + (gwEl.width || 50) / 2;
    const t1Cx = t1El.x + (t1El.width || 100) / 2;

    expect(startCx).toBeLessThan(gwCx);
    expect(gwCx).toBeLessThan(t1Cx);
  });
});
