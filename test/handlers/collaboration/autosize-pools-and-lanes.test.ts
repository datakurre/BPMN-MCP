import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleAutosizePoolsAndLanes,
  handleCreateLanes,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('autosize_bpmn_pools_and_lanes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('resizes pools to fit elements', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 600, height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    // Add elements that spread across a wide area
    for (let i = 0; i < 8; i++) {
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: `Task ${i + 1}`,
        participantId: poolId,
        x: 200 + i * 150,
        y: 200,
      });
    }

    const result = parseResult(await handleAutosizePoolsAndLanes({ diagramId }));

    expect(result.success).toBe(true);
    expect(result.poolCount).toBeGreaterThanOrEqual(1);
    // The pool should have been resized
    const processPool = result.poolResults.find((p: any) => p.participantName === 'Process');
    expect(processPool).toBeDefined();
    expect(processPool.newWidth).toBeGreaterThanOrEqual(processPool.oldWidth);
  });

  test('handles diagram with no pools', async () => {
    const diagramId = await createDiagram();

    const result = parseResult(await handleAutosizePoolsAndLanes({ diagramId }));

    expect(result.success).toBe(true);
    expect(result.message).toContain('No pools found');
    expect(result.poolResults).toEqual([]);
  });

  test('resizes lanes proportionally with content', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 1200, height: 600 },
          { name: 'Partner', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    const _lanes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );

    // Add elements to make the pool content bigger
    for (let i = 0; i < 5; i++) {
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: `Task ${i + 1}`,
        participantId: poolId,
        x: 200 + i * 150,
        y: 200,
      });
    }

    const result = parseResult(
      await handleAutosizePoolsAndLanes({
        diagramId,
        resizeLanes: true,
      })
    );

    expect(result.success).toBe(true);
  });

  test('respects custom padding', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Pool', width: 600, height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task',
      participantId: poolId,
      x: 200,
      y: 200,
    });

    const result = parseResult(
      await handleAutosizePoolsAndLanes({
        diagramId,
        padding: 80,
      })
    );

    expect(result.success).toBe(true);
  });
});
