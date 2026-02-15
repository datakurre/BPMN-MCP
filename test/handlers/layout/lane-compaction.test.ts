/**
 * Tests for post-layout lane compaction.
 *
 * Verifies that lanes are compacted to their minimum required height
 * rather than being scaled up to fill an oversized pool.
 */

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
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('lane compaction', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('lanes are compacted to minimum height after layout', async () => {
    const diagramId = await createDiagram('Lane Compaction');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const laneIds = laneResult.laneIds as string[];

    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start, t1, t2, end],
    });

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    const registry = getRegistry(diagramId);
    const pool = registry.get(poolId);
    const laneA = registry.get(laneIds[0]);
    const laneB = registry.get(laneIds[1]);

    // Both lanes should have positive dimensions
    expect(laneA.height).toBeGreaterThan(0);
    expect(laneB.height).toBeGreaterThan(0);

    // Pool height should equal the sum of lane heights (compacted)
    const totalLaneHeight = laneA.height + laneB.height;
    expect(Math.abs(pool.height - totalLaneHeight)).toBeLessThanOrEqual(2);

    // Lanes should tile vertically with no gaps
    expect(Math.abs(laneB.y - (laneA.y + laneA.height))).toBeLessThanOrEqual(2);
  });

  test('lane with content is not unnecessarily tall', async () => {
    const diagramId = await createDiagram('Compact Lane Heights');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Active' }, { name: 'Archive' }, { name: 'Admin' }],
      })
    );
    const laneIds = laneResult.laneIds as string[];

    // All elements in first lane; other lanes empty
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start, t1, end],
    });

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const pool = registry.get(poolId);

    // With 3 lanes at minimum height (250px each), pool should be ~750px
    // Without compaction (old behaviour), pool could be much taller due
    // to ELK sizing the pool for a flat layout, then scaling lanes up.
    expect(pool.height).toBeLessThanOrEqual(1000);
  });

  test('lane order is preserved after compaction', async () => {
    const diagramId = await createDiagram('Lane Order');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const wrapResult = parseResult(
      await handleWrapProcessInCollaboration({
        diagramId,
        participantName: 'Process',
      })
    );
    const poolId = wrapResult.participantIds[0];

    const laneResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }],
      })
    );
    const laneIds = laneResult.laneIds as string[];

    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [start, t1],
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[2],
      elementIds: [t2, end],
    });

    await handleLayoutDiagram({ diagramId });

    const registry = getRegistry(diagramId);
    const lane1 = registry.get(laneIds[0]);
    const lane2 = registry.get(laneIds[1]);
    const lane3 = registry.get(laneIds[2]);

    expect(lane1.y).toBeLessThan(lane2.y);
    expect(lane2.y).toBeLessThan(lane3.y);
  });
});
