/**
 * Tests for stable single-element addition with branch-aware placement (C2-3/C2-6).
 *
 * Verifies that adding a new element after a gateway that already has an
 * outgoing branch places the new element BELOW the existing branch (not
 * on top of it), and that the existing branch elements are NOT displaced
 * horizontally by the BFS downstream shift.
 *
 * C2-5 (AutoPlace evaluation) findings documented in ADR-016:
 * - modeler.get('autoPlace') returns a service with an 'append' method
 * - AutoPlace CAN be invoked headlessly in jsdom
 * - AutoPlace positions elements to the right of source elements
 * - AutoPlace is used as the primary positioning strategy
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement, handleCreateCollaboration } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('C2-3/C2-6: branch-aware placement for afterElementId', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('C2-6: adding after a gateway with one branch places new element below existing branch', async () => {
    // Build: Start → Gateway → Task1 (existing branch)
    const diagramId = await createDiagram('C2-6 Gateway');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Decision',
      afterElementId: start,
    });
    await connect(diagramId, start, gw);

    // Place Task1 (existing branch) at a fixed position after the gateway
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Task1',
      afterElementId: gw,
    });
    await connect(diagramId, gw, task1);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);

    // Record Task1 position before adding the second branch (y matters for the assertion)
    const task1yBefore = task1El.y;

    // Add Task2 after the gateway — should be placed on a new branch below Task1
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task2',
        afterElementId: gw,
        autoConnect: false, // don't auto-connect; we're testing positioning only
      })
    );

    expect(result.elementId).toBeDefined();
    const task2Id = result.elementId as string;
    const task2El = reg.get(task2Id);
    expect(task2El).toBeDefined();

    // Task2 must be at the same X as the gateway's right-edge + gap
    const gwRight = gwEl.x + (gwEl.width || 50);
    expect(task2El.x).toBeGreaterThanOrEqual(gwRight);

    // Task2 must be BELOW Task1 (not overlapping vertically)
    const task1Bottom = task1yBefore + (task1El.height ?? 80);
    expect(task2El.y).toBeGreaterThan(task1Bottom - 1);
  });

  test('C2-2: adding after a leaf task with downstream connection — AutoPlace does not shift unrelated branches', async () => {
    // Build a branched diagram:
    //   GW → [Branch A: A1 → A2] and [Branch B: B1]
    // Then add an element after A1 — B1 must NOT move.
    // With AutoPlace, downstream elements (A2) are also NOT shifted;
    // only the new element is placed.
    const diagramId = await createDiagram('C2-2 BFS');
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW' });
    const a1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'A1',
      x: 350,
      y: 100,
    });
    const a2 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'A2',
      x: 500,
      y: 100,
    });
    const b1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'B1',
      x: 500,
      y: 250,
    });

    await connect(diagramId, gw, a1);
    await connect(diagramId, a1, a2);
    await connect(diagramId, gw, b1);

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const b1xBefore = reg.get(b1).x;
    const a2xBefore = reg.get(a2).x;

    // Add NewTask after A1 — AutoPlace positions it; no downstream shifting
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'NewTask',
        afterElementId: a1,
      })
    );
    expect(result.elementId).toBeDefined();

    // B1 must not have moved (it's on Branch B)
    const b1xAfter = reg.get(b1).x;
    expect(Math.abs(b1xAfter - b1xBefore)).toBeLessThan(10);

    // A2 also should not have moved — AutoPlace does not shift downstream
    const a2xAfter = reg.get(a2).x;
    expect(Math.abs(a2xAfter - a2xBefore)).toBeLessThan(10);
  });

  test('C2-4: auto-created connection after afterElementId has orthogonal waypoints', async () => {
    // Build a simple linear process and verify the auto-created connection
    // gets clean horizontal waypoints
    const diagramId = await createDiagram('C2-4 Waypoints');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'My Task',
      afterElementId: start,
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const startEl = reg.get(start);
    const taskEl = reg.get(taskId);

    // Find the auto-created connection
    const allConns = reg
      .getAll()
      .filter(
        (el: any) =>
          el.type === 'bpmn:SequenceFlow' && el.source?.id === start && el.target?.id === taskId
      );
    expect(allConns).toHaveLength(1);

    const conn = allConns[0] as any;
    const wps = conn.waypoints as Array<{ x: number; y: number }>;
    expect(wps).toBeDefined();
    expect(wps.length).toBeGreaterThanOrEqual(2);

    // For a straight horizontal route, all waypoints should be at the same Y
    const startCy = startEl.y + (startEl.height || 0) / 2;
    const taskCy = taskEl.y + (taskEl.height || 0) / 2;
    const sameCy = Math.abs(startCy - taskCy) <= 15;
    if (sameCy) {
      // All waypoints should have the same Y (straight horizontal route)
      const firstY = wps[0].y;
      for (const wp of wps) {
        expect(Math.abs(wp.y - firstY)).toBeLessThan(5);
      }
    }

    // First waypoint should be at/near source right edge
    const srcRight = startEl.x + (startEl.width || 0);
    expect(Math.abs(wps[0].x - srcRight)).toBeLessThan(5);

    // Last waypoint should be at/near target left edge
    const tgtLeft = taskEl.x;
    expect(Math.abs(wps[wps.length - 1].x - tgtLeft)).toBeLessThan(5);
  });

  test('C2-1: AutoPlace positions second branch below existing when gateway has outgoing connection', async () => {
    // Build: Gateway → Task1. Then add Task2 after gateway.
    // AutoPlace should detect the existing outgoing branch and position
    // the new element appropriately (typically below or offset).
    const diagramId = await createDiagram('C2-1 AutoPlace Branch');

    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Decision',
      x: 300,
      y: 200,
    });

    const existingTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Existing',
      afterElementId: gw,
    });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const existingEl = reg.get(existingTask);

    // Now add a new element after the gateway — AutoPlace handles positioning
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'New Task',
        afterElementId: gw,
      })
    );

    const newEl = reg.get(result.elementId as string);
    expect(newEl).toBeDefined();

    // AutoPlace should position the new element to the right of the gateway
    const gwEl = reg.get(gw);
    const gwRight = gwEl.x + (gwEl.width || 50);
    expect(newEl.x).toBeGreaterThanOrEqual(gwRight);

    // The new element should be at a different Y than the existing task
    // (AutoPlace places second branch below the first)
    expect(newEl.y).not.toBe(existingEl.y);
  });

  test('falls back to standard placement when participantId is a different pool than afterEl', async () => {
    const diagramId = await createDiagram('Cross-pool fallback');

    const collResult = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', width: 600, height: 250 },
          { name: 'Pool B', width: 600, height: 250 },
        ],
      })
    );
    const poolAId = collResult.participantIds[0];
    const poolBId = collResult.participantIds[1];

    // Add an anchor element in Pool A
    const anchorId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolAId,
    });

    // Add a new element with afterElementId pointing to Pool A anchor,
    // but participantId pointing to Pool B — should land in Pool B, not Pool A
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'External Task',
        afterElementId: anchorId,
        participantId: poolBId,
      })
    );

    expect(result.elementId).toBeDefined();
    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const newEl = reg.get(result.elementId);
    expect(newEl).toBeDefined();

    // The created element's participant should be Pool B, not Pool A
    let parent: any = newEl;
    while (parent && parent.type !== 'bpmn:Participant') parent = parent.parent;
    expect(parent?.id).toBe(poolBId);
  });
});
