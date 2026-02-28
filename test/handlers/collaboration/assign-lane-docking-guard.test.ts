/**
 * Regression test: `assign_bpmn_elements_to_lane` must NOT crash with
 * "unexpected dockingDirection: <undefined>" when elements already have
 * connected sequence flows.
 *
 * The crash originates in diagram-js ManhattanLayout when
 * `modeling.moveElements()` is called on a connected element and the
 * connection waypoints are in an inconsistent state.  The fix wraps
 * the move in a try/catch inside `repositionInLane`.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAssignElementsToLane,
  handleCreateParticipant,
  handleCreateLanes,
  handleConnect,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('assign_bpmn_elements_to_lane — docking crash guard', () => {
  beforeEach(() => clearDiagrams());

  test('does not crash when assigning a connected task to a lane (reposition=true)', async () => {
    const diagramId = await createDiagram();

    // Create a pool with two lanes
    const poolRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Groceries',
        height: 300,
      })
    );
    const participantId = poolRes.participantId;

    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Customer' }, { name: 'Store' }],
      })
    );
    const [laneA, laneB] = lanesRes.laneIds as string[];

    // Add two connected tasks
    const t1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Enter Order',
      participantId,
      x: 200,
      y: 150,
    });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      participantId,
      x: 380,
      y: 150,
    });
    await handleConnect({ diagramId, sourceElementId: t1, targetElementId: t2 });

    // Assigning connected elements to a lane with reposition=true must not throw.
    // (Direct await — if it throws, the test fails with the actual docking error.)
    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneA,
        elementIds: [t1],
        reposition: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.assignedElementIds).toContain(t1);

    // Second element in a different lane — also must not crash
    const res2 = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneB,
        elementIds: [t2],
        reposition: true,
      })
    );

    expect(res2.success).toBe(true);
    expect(res2.assignedElementIds).toContain(t2);
  });

  test('emits a warning instead of crashing for docking failures', async () => {
    const diagramId = await createDiagram();

    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Pool', height: 200 })
    );
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolRes.participantId,
        lanes: [{ name: 'A' }, { name: 'B' }],
      })
    );
    const [laneA] = lanesRes.laneIds as string[];

    // Task connected to another element — this is the scenario that triggered
    // the docking crash in the original report
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolRes.participantId,
      x: 150,
      y: 100,
    });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      participantId: poolRes.participantId,
      x: 300,
      y: 100,
    });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: task });

    // Should succeed (not throw), and result should have success:true
    const res = parseResult(
      await handleAssignElementsToLane({
        diagramId,
        laneId: laneA,
        elementIds: [start, task],
        reposition: true,
      })
    );

    expect(res.success).toBe(true);
    // May emit repositionWarnings if docking fails, but must not crash
    if (res.repositionWarnings) {
      expect(Array.isArray(res.repositionWarnings)).toBe(true);
    }
  });
});
