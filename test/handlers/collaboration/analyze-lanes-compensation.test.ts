/**
 * Tests for Issues F and G — compensation handler tasks should be excluded from
 * lane analysis in both validate and suggest modes.
 *
 * Issue F: validate mode — ServiceTask with isForCompensation=true may not appear in
 * lane.flowNodeRef (bpmn-js places it in the process but not in the lane membership
 * list), causing checkUnassigned() to emit a false-positive 'elements-not-in-lane' warning.
 *
 * Issue G: suggest mode — compensation handlers look like regular ServiceTasks to
 * buildRoleSuggestions(), so they land in "Automated Tasks". They should be excluded
 * because they are not part of the normal flow.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleAnalyzeLanes } from '../../../src/handlers/collaboration/analyze-lanes';
import {
  handleCreateParticipant,
  handleCreateLanes,
  handleAddElement,
  handleSetProperties,
  handleSetEventDefinition,
  handleConnect,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

// Helper: build a pool with two lanes and return laneIds
async function buildPoolWithTwoLanes(diagramId: string) {
  const poolRes = parseResult(
    await handleCreateParticipant({ diagramId, name: 'Payment Process' })
  );
  const participantId = poolRes.participantId as string;
  const lanesRes = parseResult(
    await handleCreateLanes({
      diagramId,
      participantId,
      lanes: [{ name: 'Customer' }, { name: 'System' }],
    })
  );
  const customerLaneId = lanesRes.laneIds[0] as string;
  const systemLaneId = lanesRes.laneIds[1] as string;
  return { participantId, customerLaneId, systemLaneId };
}

describe('Issue F — compensation handlers should not be flagged as unassigned (validate)', () => {
  beforeEach(() => clearDiagrams());

  test('ServiceTask with isForCompensation=true does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const { participantId, systemLaneId } = await buildPoolWithTwoLanes(diagramId);

    // Main task in the System lane
    const chargeTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Charge Card',
      laneId: systemLaneId,
    });

    // Compensation boundary event on the main task
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: chargeTask,
      })
    );
    const boundaryId = boundaryRes.elementId as string;
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    // Compensation handler task — isForCompensation=true
    const handlerRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Refund Card',
        laneId: systemLaneId,
      })
    );
    const handlerId = handlerRes.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: handlerId,
      properties: { isForCompensation: true },
    });

    // Connect boundary → handler via Association
    await handleConnect({
      diagramId,
      sourceElementId: boundaryId,
      targetElementId: handlerId,
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);
  });

  test('compensation handler does NOT inflate totalFlowNodes count', async () => {
    const diagramId = await createDiagram();
    const { participantId, systemLaneId } = await buildPoolWithTwoLanes(diagramId);

    const normalTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      laneId: systemLaneId,
    });

    // Count before adding compensation handler
    const resBefore = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );
    const countBefore = resBefore.totalFlowNodes as number;

    // Add compensation boundary + handler
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: normalTask,
      })
    );
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryRes.elementId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });
    const handlerRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Undo Payment',
        laneId: systemLaneId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: handlerRes.elementId,
      properties: { isForCompensation: true },
    });

    const resAfter = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );
    // totalFlowNodes should not include the compensation handler
    expect(resAfter.totalFlowNodes).toBe(countBefore);
  });

  test('compensation boundary event itself does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const { participantId, systemLaneId } = await buildPoolWithTwoLanes(diagramId);

    const task = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Reserve Stock',
      laneId: systemLaneId,
    });

    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: task,
      })
    );
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryRes.elementId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);
  });
});

describe('Issue G — compensation handlers should not appear in "Automated Tasks" (suggest)', () => {
  beforeEach(() => clearDiagrams());

  test('compensation handler ServiceTask is NOT included in any suggest-mode lane suggestions', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(
      await handleCreateParticipant({ diagramId, name: 'Compensation Process' })
    );
    const participantId = poolRes.participantId as string;

    // One assigned human task
    const humanTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve Refund',
      participantId,
    });
    await handleSetProperties({
      diagramId,
      elementId: humanTask,
      properties: { 'camunda:candidateGroups': 'finance' },
    });

    // One regular service task (should appear in "Automated Tasks")
    const serviceTask = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Charge Card',
      participantId,
    });

    // Compensation boundary + handler
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        hostElementId: serviceTask,
      })
    );
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryRes.elementId,
      eventDefinitionType: 'bpmn:CompensateEventDefinition',
    });
    const handlerRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Refund Card',
        participantId,
      })
    );
    const handlerId = handlerRes.elementId as string;
    await handleSetProperties({
      diagramId,
      elementId: handlerId,
      properties: { isForCompensation: true },
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
    );

    // Collect all element IDs from all suggestions
    const allSuggestionIds: string[] = (res.suggestions ?? []).flatMap(
      (s: any) => s.elementIds ?? []
    );
    // Compensation handler must not appear in any suggestion group
    expect(allSuggestionIds).not.toContain(handlerId);
  });

  test('compensation handler is NOT included in "Automated Tasks" element names', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Payment Flow' }));
    const participantId = poolRes.participantId as string;

    // Assigned human task (provides 2nd distinct role for role-based grouping)
    const humanTask = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Enter Details',
      participantId,
    });
    await handleSetProperties({
      diagramId,
      elementId: humanTask,
      properties: { 'camunda:candidateGroups': 'customer' },
    });

    // Regular service task — no role — goes into "Automated Tasks"
    await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Payment',
      participantId,
    });

    // Compensation handler — must NOT go into "Automated Tasks"
    const compHandler = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Reverse Payment',
      participantId,
    });
    await handleSetProperties({
      diagramId,
      elementId: compHandler,
      properties: { isForCompensation: true },
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
    );

    const automatedSuggestion = (res.suggestions ?? []).find(
      (s: any) => s.laneName === 'Automated Tasks'
    );
    const automatedNames: string[] = automatedSuggestion?.elementNames ?? [];
    expect(automatedNames).not.toContain('Reverse Payment');
  });
});
