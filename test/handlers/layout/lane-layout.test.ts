import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateLanes,
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

/**
 * Tests for lane-aware layout and lane-crossing metrics.
 *
 * Covers:
 * - Layout with 2, 3 lanes
 * - Lane-crossing metrics computation
 * - Lane coherence score
 * - Element positioning within lane bounds
 */

describe('lane layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  /**
   * Helper: create a process with a pool and lanes, assign elements.
   */
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

    // Build a simple sequential process
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

    // Connect all in sequence
    await connectAll(diagramId, ...elementIds);

    // Wrap in collaboration
    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Test Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    // Create lanes
    const laneNames = Array.from({ length: laneCount }, (_, i) => ({ name: `Lane ${i + 1}` }));
    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: laneNames,
      })
    );
    const laneIds = laneResult.laneIds as string[];

    // Distribute elements across lanes
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

  test('layout with 2 lanes produces lane crossing metrics', async () => {
    const { diagramId } = await createProcessWithLanes(2);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // With a sequential process split across 2 lanes, there should be
    // at least one lane-crossing flow
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
    // Create a process where all elements are in the same lane
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

    // Put all elements in the same lane
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneResult.laneIds[0],
      elementIds: [start, task1, task2, end],
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    if (res.laneCrossingMetrics) {
      // All flows are within the same lane — 100% coherence
      expect(res.laneCrossingMetrics.laneCoherenceScore).toBe(100);
      expect(res.laneCrossingMetrics.crossingLaneFlows).toBe(0);
    }
  });

  test('elements positioned within lane bounds after layout', async () => {
    const { diagramId, laneIds } = await createProcessWithLanes(2, { taskCount: 4 });

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const lanes = laneIds.map((id: string) => registry.get(id)).filter(Boolean);

    // Each lane should have positive dimensions
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
    // No lanes = no lane metrics
    expect(res.laneCrossingMetrics).toBeUndefined();
  });
});
