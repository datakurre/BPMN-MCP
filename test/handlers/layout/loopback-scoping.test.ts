/**
 * Tests for loopback routing scoped to participant pools.
 *
 * Verifies that in collaboration diagrams, loopback connections route
 * below the elements within their own pool, not below all elements
 * across all pools.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

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
