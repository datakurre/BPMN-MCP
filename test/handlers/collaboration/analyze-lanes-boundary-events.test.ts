/**
 * Tests for Issue E — BoundaryEvents should not appear as unassigned in validate mode.
 *
 * bpmn:BoundaryEvent nodes live in process.flowElements but bpmn-js does NOT add
 * them to lane.flowNodeRef (they inherit their host task's lane visually). Before
 * the fix, partitionFlowElements() would include them in flowNodes, and
 * checkUnassigned() would flag them as not-in-lane because buildLaneMap() only
 * reads flowNodeRef entries.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleAnalyzeLanes } from '../../../src/handlers/collaboration/analyze-lanes';
import {
  handleCreateParticipant,
  handleCreateLanes,
  handleAddElement,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('Issue E — BoundaryEvents should not be flagged as unassigned in validate mode', () => {
  beforeEach(() => clearDiagrams());

  test('timer boundary event on task in a lane does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Support Process' })
    );
    const participantId = poolRes.participantId;
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Agent' }, { name: 'System' }],
      })
    );
    const agentLaneId = lanesRes.laneIds[0] as string;

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Handle Request',
      laneId: agentLaneId,
    });

    // Attach a timer boundary event to the task
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT1H' },
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);
  });

  test('error boundary event on task in a lane does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Order Process' })
    );
    const participantId = poolRes.participantId;
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Operations' }, { name: 'System' }],
      })
    );
    const systemLaneId = lanesRes.laneIds[1] as string;

    const serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Call External API',
      laneId: systemLaneId,
    });

    // Attach an error boundary event to the service task
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: serviceTask,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: { id: 'Error_ApiFailed', name: 'API Failed' },
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);
  });

  test('multiple boundary events (timer + error) on tasks do NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Mixed Process' })
    );
    const participantId = poolRes.participantId;
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Agent' }, { name: 'System' }],
      })
    );
    const agentLaneId = lanesRes.laneIds[0] as string;
    const systemLaneId = lanesRes.laneIds[1] as string;

    const userTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review Task',
      laneId: agentLaneId,
    });
    const serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      laneId: systemLaneId,
    });

    // Timer boundary on user task
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: userTask,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT2H' },
    });

    // Error boundary on service task
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: serviceTask,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: { id: 'Error_PaymentFailed', name: 'Payment Failed' },
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);
  });

  test('BoundaryEvent IDs do not appear in any suggest-mode suggestion elementIds', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Suggest Process' })
    );
    const participantId = poolRes.participantId;

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      participantId,
    });

    // Add timer boundary event — its ID must not appear in any suggestion
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT30M' },
      })
    );
    const boundaryId = boundaryRes.elementId as string;

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
    );

    // Collect all element IDs from all suggestions
    const allSuggestionIds: string[] = (res.suggestions ?? []).flatMap(
      (s: any) => s.elementIds ?? []
    );
    expect(allSuggestionIds).not.toContain(boundaryId);
  });

  test('validate totalFlowNodes does NOT count boundary events', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Count Test' }));
    const participantId = poolRes.participantId;
    const lanesRes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const laneAId = lanesRes.laneIds[0] as string;

    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Main Task',
      laneId: laneAId,
    });

    // Before adding boundary event
    const resBefore = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );
    const countBefore = resBefore.totalFlowNodes as number;

    // Add boundary event
    await handleAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT1H' },
    });

    const resAfter = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );
    const countAfter = resAfter.totalFlowNodes as number;

    // totalFlowNodes must not increase when only a boundary event was added
    expect(countAfter).toBe(countBefore);
  });
});
