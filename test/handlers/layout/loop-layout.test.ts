/**
 * Integration test for loop-back patterns in layout.
 *
 * Validates that diagrams containing cycles (loop-back edges) maintain
 * left-to-right directionality for the main path after layout.
 *
 * Covers: Cycles (Loops) and their impact on layering quality.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Assert all waypoints of a connection form strictly orthogonal segments. */
function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  expect(wps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    expect(
      isHorizontal || isVertical,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Loop-back layout (Root Cause 4)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('simple loop: maintains left-to-right directionality for the main path', async () => {
    // Pattern: Start → Task1 → Gateway → Task2 → End
    //                             ↑                ↓ (loop back: "No" branch)
    //                             └── Retry Task ──┘
    const diagramId = await createDiagram('Simple Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, gw);
    await connect(diagramId, gw, task2, { label: 'Yes' });
    await connect(diagramId, task2, end);
    // Loop-back edge: gateway "No" branch goes back to task1
    await connect(diagramId, gw, task1, { label: 'No' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main path should flow left-to-right: Start < Task1 < Gateway < Process < End
    const startEl = reg.get(start);
    const task1El = reg.get(task1);
    const gwEl = reg.get(gw);
    const task2El = reg.get(task2);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(task1El));
    expect(centreX(task1El)).toBeLessThan(centreX(gwEl));
    expect(centreX(gwEl)).toBeLessThan(centreX(task2El));
    expect(centreX(task2El)).toBeLessThan(centreX(endEl));

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });

  test('review loop: approval with retry maintains left-to-right flow', async () => {
    // Pattern: Start → Draft → Review → Approved? → Publish → End
    //                            ↑                     ↓ (loop: "Revise" branch)
    //                            └─── Revise ──────────┘
    const diagramId = await createDiagram('Review Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const draft = await addElement(diagramId, 'bpmn:UserTask', { name: 'Draft' });
    const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
    const publish = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Publish' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, draft);
    await connect(diagramId, draft, review);
    await connect(diagramId, review, gw);
    await connect(diagramId, gw, publish, { label: 'Yes' });
    await connect(diagramId, publish, end);
    // Loop-back: Rejected → back to Draft
    await connect(diagramId, gw, draft, { label: 'Revise' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main path should flow left-to-right
    const startEl = reg.get(start);
    const draftEl = reg.get(draft);
    const reviewEl = reg.get(review);
    const gwEl = reg.get(gw);
    const publishEl = reg.get(publish);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(draftEl));
    expect(centreX(draftEl)).toBeLessThan(centreX(reviewEl));
    expect(centreX(reviewEl)).toBeLessThan(centreX(gwEl));
    expect(centreX(gwEl)).toBeLessThan(centreX(publishEl));
    expect(centreX(publishEl)).toBeLessThan(centreX(endEl));
  });

  test('multi-step loop: iterative processing maintains ordering', async () => {
    // Pattern: Start → Init → Process → Check → End
    //                   ↑                  ↓ (loop back to Init)
    //                   └──────────────────┘
    const diagramId = await createDiagram('Multi-Step Loop');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const init = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Initialize' });
    const process = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Item' });
    const check = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'More items?' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Complete' });

    await connect(diagramId, start, init);
    await connect(diagramId, init, process);
    await connect(diagramId, process, check);
    await connect(diagramId, check, end, { label: 'No' });
    // Loop-back: "Yes" → back to Init for next iteration
    await connect(diagramId, check, init, { label: 'Yes' });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Main forward path should flow left-to-right
    const startEl = reg.get(start);
    const initEl = reg.get(init);
    const processEl = reg.get(process);
    const checkEl = reg.get(check);
    const endEl = reg.get(end);

    expect(centreX(startEl)).toBeLessThan(centreX(initEl));
    expect(centreX(initEl)).toBeLessThan(centreX(processEl));
    expect(centreX(processEl)).toBeLessThan(centreX(checkEl));
    expect(centreX(checkEl)).toBeLessThan(centreX(endEl));

    // All connections should be strictly orthogonal
    const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
    for (const conn of connections) {
      expectOrthogonal(conn);
    }
  });
});

describe('loopback routing — participant scoping', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('loopback in first pool stays within pool bounds', async () => {
    const diagramId = await createDiagram('Scoped Loopback');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool A', height: 300 },
          { name: 'Pool B', height: 300 },
        ],
      })
    );

    const poolA = collab.participantIds[0];
    const poolB = collab.participantIds[1];

    // Build a process with loopback in Pool A
    const startA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start A',
        participantId: poolA,
      })
    );
    const taskA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Enter Data',
        participantId: poolA,
      })
    );
    const gwA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Valid?',
        participantId: poolA,
      })
    );
    const endA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done A',
        participantId: poolA,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: startA.elementId,
      targetElementId: taskA.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: taskA.elementId,
      targetElementId: gwA.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: gwA.elementId,
      targetElementId: endA.elementId,
      label: 'Yes',
    });

    // Loopback from gateway back to task
    const loopFlow = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: gwA.elementId,
        targetElementId: taskA.elementId,
        label: 'No',
      })
    );

    // Add elements in Pool B (lower in the diagram)
    const startB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start B',
        participantId: poolB,
      })
    );
    const taskB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process B',
        participantId: poolB,
      })
    );
    const endB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done B',
        participantId: poolB,
      })
    );

    await handleConnect({
      diagramId,
      sourceElementId: startB.elementId,
      targetElementId: taskB.elementId,
    });
    await handleConnect({
      diagramId,
      sourceElementId: taskB.elementId,
      targetElementId: endB.elementId,
    });

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

    // Get Pool A's bounds
    const poolAEl = reg.get(poolA);
    expect(poolAEl).toBeDefined();
    const poolABottom = poolAEl.y + poolAEl.height;

    // Get Pool B's bounds
    const poolBEl = reg.get(poolB);
    expect(poolBEl).toBeDefined();
    const poolBTop = poolBEl.y;
    const poolBBottom = poolBEl.y + poolBEl.height;

    // Get the loopback connection
    const loopConn = reg.get(loopFlow.connectionId);
    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();

    // The loopback's maximum Y should stay within Pool A's bounds.
    // With participant-scoped routing, the loopback should route below
    // the elements within Pool A, not below all elements across all pools.
    const loopMaxY = Math.max(...loopConn.waypoints.map((wp: any) => wp.y));

    // The loopback should stay within Pool A's bounds
    expect(
      loopMaxY,
      `Loopback max Y (${loopMaxY}) should be within Pool A bounds (${poolAEl.y}-${poolABottom})`
    ).toBeLessThanOrEqual(poolABottom);

    // The loopback should NOT extend into Pool B's territory
    // (pools may be in any order — check both above and below)
    if (poolBTop > poolABottom) {
      // Pool B is below Pool A
      expect(
        loopMaxY,
        `Loopback max Y (${loopMaxY}) should be above Pool B top (${poolBTop})`
      ).toBeLessThan(poolBTop);
    } else if (poolBBottom < poolAEl.y) {
      // Pool B is above Pool A
      const loopMinY = Math.min(...loopConn.waypoints.map((wp: any) => wp.y));
      expect(
        loopMinY,
        `Loopback min Y (${loopMinY}) should be below Pool B bottom (${poolBBottom})`
      ).toBeGreaterThan(poolBBottom);
    }
  });
});
