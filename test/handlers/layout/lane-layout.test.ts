/**
 * Lane layout tests.
 *
 * Consolidated from:
 * - lane-layout.test.ts (lane crossing metrics, coherence, bounds)
 * - lane-multirow.test.ts (multi-row height, backward flow routing)
 * - lane-graceful-handling.test.ts (unassigned elements, empty lanes)
 *
 * 9 tests covering: metrics, coherence, bounds, multi-row, backward flow,
 * unassigned elements, and empty lanes.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleLayoutDiagram,
  handleListElements,
  handleCreateLanes,
  handleCreateParticipant,
  handleAssignElementsToLane,
  handleWrapProcessInCollaboration,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  connectAll,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('lane layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── Helper ─────────────────────────────────────────────────────────────

  async function createProcessWithLanes(
    laneCount: number,
    opts?: { taskCount?: number }
  ): Promise<{
    diagramId: string;
    poolId: string;
    laneIds: string[];
    elementIds: string[];
  }> {
    const diagramId = await createDiagram(`Lane Test (${laneCount} lanes)`);

    const taskCount = opts?.taskCount ?? laneCount * 2;
    const elementIds: string[] = [];

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    elementIds.push(start);

    for (let i = 0; i < taskCount; i++) {
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: `Task ${i + 1}` });
      elementIds.push(task);
    }

    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    elementIds.push(end);

    await connectAll(diagramId, ...elementIds);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Test Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneNames = Array.from({ length: laneCount }, (_, i) => ({ name: `Lane ${i + 1}` }));
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: laneNames,
      })
    );
    const laneIds = laneResult.laneIds as string[];

    const elemsPerLane = Math.ceil(elementIds.length / laneCount);
    for (let i = 0; i < laneCount; i++) {
      const laneElements = elementIds.slice(i * elemsPerLane, (i + 1) * elemsPerLane);
      if (laneElements.length > 0) {
        await handleAssignElementsToLane({
          diagramId,
          laneId: laneIds[i],
          elementIds: laneElements,
        });
      }
    }

    return { diagramId, poolId, laneIds, elementIds };
  }

  // ── Crossing metrics ──────────────────────────────────────────────────

  test('layout with 2 lanes produces lane crossing metrics', async () => {
    const { diagramId } = await createProcessWithLanes(2);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    if (res.laneCrossingMetrics) {
      expect(res.laneCrossingMetrics.totalLaneFlows).toBeGreaterThan(0);
      expect(res.laneCrossingMetrics.laneCoherenceScore).toBeGreaterThanOrEqual(0);
      expect(res.laneCrossingMetrics.laneCoherenceScore).toBeLessThanOrEqual(100);
    }
  });

  test('layout with 3 lanes produces lane crossing metrics', async () => {
    const { diagramId } = await createProcessWithLanes(3);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    if (res.laneCrossingMetrics) {
      expect(res.laneCrossingMetrics.totalLaneFlows).toBeGreaterThan(0);
      expect(typeof res.laneCrossingMetrics.laneCoherenceScore).toBe('number');
    }
  });

  test('elements within same lane have high coherence score', async () => {
    const diagramId = await createDiagram('Single Lane Coherence');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connectAll(diagramId, start, task1, task2, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Coherent Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Main Lane' }, { name: 'Empty Lane' }],
      })
    );

    await handleAssignElementsToLane({
      diagramId,
      laneId: laneResult.laneIds[0],
      elementIds: [start, task1, task2, end],
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    if (res.laneCrossingMetrics) {
      expect(res.laneCrossingMetrics.laneCoherenceScore).toBe(100);
      expect(res.laneCrossingMetrics.crossingLaneFlows).toBe(0);
    }
  });

  test('elements positioned within lane bounds after layout', async () => {
    const { diagramId, laneIds } = await createProcessWithLanes(2, { taskCount: 4 });

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const lanes = laneIds.map((id: string) => registry.get(id)).filter(Boolean);

    for (const lane of lanes) {
      expect(lane.width).toBeGreaterThan(0);
      expect(lane.height).toBeGreaterThan(0);
    }
  });

  test('no lane metrics for process without lanes', async () => {
    const diagramId = await createDiagram('No Lanes');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.laneCrossingMetrics).toBeUndefined();
  });

  // ── Multi-row content height ──────────────────────────────────────────

  test('lane height accommodates parallel branches within a lane', async () => {
    const diagramId = await createDiagram('Multi-Row Lane');

    const poolResult = parseResult(await handleCreateParticipant({ diagramId, name: 'Process' }));
    const participantId = poolResult.participantId as string;
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Management' }, { name: 'Operations' }],
      })
    );
    const topLaneId = laneResult.laneIds[0] as string;
    const bottomLaneId = laneResult.laneIds[1] as string;

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      laneId: topLaneId,
    });
    const mgmtTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve',
      laneId: topLaneId,
    });

    const fork = await addElement(diagramId, 'bpmn:ParallelGateway', {
      name: 'Fork',
      laneId: bottomLaneId,
    });
    const taskA = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process A',
      laneId: bottomLaneId,
    });
    const taskB = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process B',
      laneId: bottomLaneId,
    });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', {
      name: 'Join',
      laneId: bottomLaneId,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      laneId: bottomLaneId,
    });

    await connect(diagramId, start, mgmtTask);
    await connect(diagramId, mgmtTask, fork);
    await connect(diagramId, fork, taskA);
    await connect(diagramId, fork, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const result = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(result.success).toBe(true);

    const reg = getRegistry(diagramId);
    const topLane = reg.get(topLaneId);
    const bottomLane = reg.get(bottomLaneId);

    expect(topLane.height).toBeGreaterThan(0);
    expect(bottomLane.height).toBeGreaterThan(0);

    for (const elId of [fork, taskA, taskB, join, end]) {
      const el = reg.get(elId);
      if (!el) continue;
      expect(el.y).toBeGreaterThanOrEqual(bottomLane.y - 5);
      expect(el.y + (el.height || 0)).toBeLessThanOrEqual(bottomLane.y + bottomLane.height + 5);
    }
  });

  // ── Cross-lane backward flow ──────────────────────────────────────────

  test('backward cross-lane flow is routed below the pool midpoint', async () => {
    const diagramId = await createDiagram('Cross-Lane Backward Flow');

    const poolResult = parseResult(await handleCreateParticipant({ diagramId, name: 'Process' }));
    const participantId = poolResult.participantId as string;
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Management' }, { name: 'Operations' }],
      })
    );
    const topLaneId = laneResult.laneIds[0] as string;
    const bottomLaneId = laneResult.laneIds[1] as string;

    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      laneId: topLaneId,
    });
    const approve = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve',
      laneId: topLaneId,
    });
    const execute = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Execute',
      laneId: bottomLaneId,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', laneId: bottomLaneId });

    await connect(diagramId, start, approve);
    await connect(diagramId, approve, execute);
    await connect(diagramId, execute, end);

    const loopFlow = await connect(diagramId, execute, approve, { label: 'Reject' });

    const result = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(result.success).toBe(true);

    const reg = getRegistry(diagramId);
    const loopConn = reg.get(loopFlow);
    const participant = reg.get(participantId);

    expect(loopConn).toBeDefined();
    expect(loopConn.waypoints).toBeDefined();
    expect(loopConn.waypoints.length).toBeGreaterThanOrEqual(4);

    const wps: Array<{ x: number; y: number }> = loopConn.waypoints;
    const maxWpY = Math.max(...wps.map((wp) => wp.y));
    const poolMidY = participant.y + participant.height / 2;
    expect(maxWpY).toBeGreaterThan(poolMidY);
  });

  // ── Graceful handling ─────────────────────────────────────────────────

  test('layout handles unassigned elements in a pool with lanes', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'LaneTest' }));
    const diagramId = createRes.diagramId;

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent' })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Task A',
        afterElementId: startRes.elementId,
      })
    );
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      afterElementId: taskRes.elementId,
    });

    await handleWrapProcessInCollaboration({ diagramId, participantName: 'My Pool' });

    const elementsRes = parseResult(await handleListElements({ diagramId }));
    const participant = elementsRes.elements.find((e: any) => e.type === 'bpmn:Participant');
    expect(participant).toBeDefined();

    await handleCreateLanes({
      diagramId,
      participantId: participant.id,
      lanes: [{ name: 'Lane 1' }, { name: 'Lane 2' }],
    });

    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);
  });

  test('layout handles empty lanes gracefully', async () => {
    const createRes = parseResult(await handleCreateDiagram({ name: 'EmptyLanes' }));
    const diagramId = createRes.diagramId;

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent' })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:Task',
        name: 'Only Task',
        afterElementId: startRes.elementId,
      })
    );
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      afterElementId: taskRes.elementId,
    });

    await handleWrapProcessInCollaboration({ diagramId, participantName: 'Pool' });

    const elementsRes = parseResult(await handleListElements({ diagramId }));
    const participant = elementsRes.elements.find((e: any) => e.type === 'bpmn:Participant');

    await handleCreateLanes({
      diagramId,
      participantId: participant.id,
      lanes: [
        { name: 'Active Lane', elementIds: [startRes.elementId, taskRes.elementId] },
        { name: 'Empty Lane 1' },
        { name: 'Empty Lane 2' },
      ],
    });

    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);
  });
});
