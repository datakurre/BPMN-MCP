/**
 * Regression tests for bugs discovered during iterative BPMN diagram building.
 *
 * Fix A: extractPrimaryRoleSuggest should prefer candidateGroups over assignee,
 *        and must not return EL expressions (${...}) as lane names.
 *
 * Fix B: When all unassigned elements are automated task types (ServiceTask,
 *        ScriptTask, etc.) the suggest mode should label them "Automated Tasks"
 *        instead of the generic "Unassigned".
 *
 * Fix C: layout_bpmn_diagram should not emit false-positive diWarnings for
 *        pool/lane shapes that are correctly registered in DI after repair.
 *
 * Fix D: suggest mode result must include a coherenceNote field to clarify that
 *        the coherenceScore reflects the proposed assignment, not the current layout.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleAnalyzeLanes } from '../../../src/handlers/collaboration/analyze-lanes';
import {
  handleCreateParticipant,
  handleSetProperties,
  handleCreateLanes,
  handleLayoutDiagram,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('analyze_bpmn_lanes — regression fixes', () => {
  beforeEach(() => clearDiagrams());

  // ─────────────────────────────────────────────────────────────────────────
  // Fix A: EL expressions must NOT appear as lane names
  // ─────────────────────────────────────────────────────────────────────────
  describe('Fix A — candidateGroups preferred over EL assignee', () => {
    test('lane name comes from candidateGroups when assignee is an EL expression', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Leave Request' })
      );
      const participantId = poolRes.participantId;

      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Submit Request',
        participantId,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve Request',
        participantId,
      });

      // EL expression assignee + candidateGroups — lane name must come from candidateGroups
      await handleSetProperties({
        diagramId,
        elementId: task1,
        properties: {
          'camunda:assignee': '${initiator}',
          'camunda:candidateGroups': 'employee',
        },
      });
      await handleSetProperties({
        diagramId,
        elementId: task2,
        properties: {
          'camunda:assignee': '${manager}',
          'camunda:candidateGroups': 'manager',
        },
      });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);

      // Must NOT contain raw EL expressions
      expect(laneNames.some((n) => n.startsWith('${'))).toBe(false);
      expect(laneNames.some((n) => n.startsWith('#{'))).toBe(false);

      // Must contain the candidateGroups values
      expect(laneNames).toContain('employee');
      expect(laneNames).toContain('manager');
    });

    test('falls back to non-EL assignee when candidateGroups is absent', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Simple Process' })
      );
      const participantId = poolRes.participantId;

      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Do Work',
        participantId,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review Work',
        participantId,
      });

      // Plain (non-EL) assignee with no candidateGroups — should use assignee
      await handleSetProperties({
        diagramId,
        elementId: task1,
        properties: { 'camunda:assignee': 'alice' },
      });
      await handleSetProperties({
        diagramId,
        elementId: task2,
        properties: { 'camunda:assignee': 'bob' },
      });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);
      expect(laneNames).toContain('alice');
      expect(laneNames).toContain('bob');
    });

    test('EL-only assignee with no candidateGroups does not produce EL lane name', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'EL Only Process' })
      );
      const participantId = poolRes.participantId;

      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task A',
        participantId,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task B',
        participantId,
      });

      // EL expressions with NO candidateGroups — must not produce "${...}" lane names
      await handleSetProperties({
        diagramId,
        elementId: task1,
        properties: { 'camunda:assignee': '${someUser}' },
      });
      await handleSetProperties({
        diagramId,
        elementId: task2,
        properties: { 'camunda:assignee': '${anotherUser}' },
      });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);
      expect(laneNames.every((n) => !n.startsWith('${'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix B: All-automated unassigned elements → "Automated Tasks" group
  // ─────────────────────────────────────────────────────────────────────────
  describe('Fix B — automated tasks grouped as "Automated Tasks" not "Unassigned"', () => {
    test('ServiceTasks without candidateGroups are labelled "Automated Tasks"', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Order Process' })
      );
      const participantId = poolRes.participantId;

      // One human task with a role
      const human = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Review Order',
        participantId,
      });
      await handleSetProperties({
        diagramId,
        elementId: human,
        properties: { 'camunda:candidateGroups': 'sales' },
      });

      // Two ServiceTasks with no role assignment
      await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Validate Payment',
        participantId,
      });
      await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Send Confirmation',
        participantId,
      });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);

      // Must NOT contain "Unassigned"
      expect(laneNames).not.toContain('Unassigned');
      // Must contain "Automated Tasks"
      expect(laneNames).toContain('Automated Tasks');
    });

    test('mixed automated types (ScriptTask + ServiceTask) without role → "Automated Tasks"', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Mixed Automated' })
      );
      const participantId = poolRes.participantId;

      // Human task with role
      const human = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Approve',
        participantId,
      });
      await handleSetProperties({
        diagramId,
        elementId: human,
        properties: { 'camunda:candidateGroups': 'approvers' },
      });

      // Automated tasks — no role
      await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API', participantId });
      await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Transform Data', participantId });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);
      expect(laneNames).not.toContain('Unassigned');
      expect(laneNames).toContain('Automated Tasks');
    });

    test('UserTask without role stays "Unassigned" (not relabelled as automated)', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Partial Roles' })
      );
      const participantId = poolRes.participantId;

      // One task with role
      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Submit',
        participantId,
      });
      await handleSetProperties({
        diagramId,
        elementId: task1,
        properties: { 'camunda:candidateGroups': 'requester' },
      });

      // UserTask without role — must remain Unassigned (not "Automated Tasks")
      await addElement(diagramId, 'bpmn:UserTask', { name: 'Unclaimed Task', participantId });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      const laneNames: string[] = res.suggestions.map((s: any) => s.laneName);
      // "Automated Tasks" must NOT appear when unassigned element is a UserTask
      expect(laneNames).not.toContain('Automated Tasks');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix C: No false-positive diWarnings for pool/lane shapes after layout
  // ─────────────────────────────────────────────────────────────────────────
  describe('Fix C — no false-positive diWarnings for pool/lane shapes', () => {
    test('layout on a participant with lanes produces no diWarnings', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Test Pool' })
      );
      const participantId = poolRes.participantId;

      // Create lanes
      const lanesRes = parseResult(
        await handleCreateLanes({
          diagramId,
          participantId,
          lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
        })
      );
      const laneAId = lanesRes.laneIds[0] as string;
      const laneBId = lanesRes.laneIds[1] as string;

      // Add elements to each lane
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneAId,
      });
      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task A',
        laneId: laneAId,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task B',
        laneId: laneBId,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', laneId: laneBId });

      await connect(diagramId, start, task1);
      await connect(diagramId, task1, task2);
      await connect(diagramId, task2, end);

      const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));

      // Must not contain DI integrity warnings for pool or lane shapes
      const diWarnings: string[] = layoutRes.diWarnings ?? [];
      const poolLaneWarnings = diWarnings.filter(
        (w) =>
          w.includes('bpmn:Participant') ||
          w.includes('bpmn:Lane') ||
          w.includes(participantId) ||
          w.includes(laneAId) ||
          w.includes(laneBId)
      );
      expect(poolLaneWarnings).toHaveLength(0);
    });

    test('layout on a pool with many lanes produces no participant diWarnings', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Multi-Lane Pool' })
      );
      const participantId = poolRes.participantId;

      await handleCreateLanes({
        diagramId,
        participantId,
        lanes: [
          { name: 'Customer' },
          { name: 'Sales' },
          { name: 'Operations' },
          { name: 'Finance' },
        ],
      });

      const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));

      const diWarnings: string[] = layoutRes.diWarnings ?? [];
      const participantWarnings = diWarnings.filter((w) => w.includes('bpmn:Participant'));
      expect(participantWarnings).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix D: suggest mode must include a coherenceNote field
  // ─────────────────────────────────────────────────────────────────────────
  describe('Fix D — coherenceNote included in suggest mode output', () => {
    test('suggest mode result always includes coherenceNote string', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Any Process' })
      );
      const participantId = poolRes.participantId;

      await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Thing', participantId });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      expect(res.coherenceNote).toBeDefined();
      expect(typeof res.coherenceNote).toBe('string');
      expect(res.coherenceNote.length).toBeGreaterThan(0);
    });

    test('coherenceNote mentions "proposed" to distinguish from validate coherence', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({ diagramId, name: 'Process' })
      );
      const participantId = poolRes.participantId;

      const task1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Step 1',
        participantId,
      });
      const task2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Step 2',
        participantId,
      });
      await handleSetProperties({
        diagramId,
        elementId: task1,
        properties: { 'camunda:candidateGroups': 'role-a' },
      });
      await handleSetProperties({
        diagramId,
        elementId: task2,
        properties: { 'camunda:candidateGroups': 'role-b' },
      });

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
      );

      expect(res.coherenceNote.toLowerCase()).toMatch(/proposed/);
    });

    test('validate mode does NOT include coherenceNote (it is suggest-only)', async () => {
      const diagramId = await createDiagram();
      const poolRes = parseResult(
        await handleCreateParticipant({
          diagramId,
          name: 'Validated Pool',
          lanes: [{ name: 'Lane X' }, { name: 'Lane Y' }],
        })
      );
      const participantId = poolRes.participantId;

      const res = parseResult(
        await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
      );

      // coherenceNote is specific to suggest mode
      expect(res.coherenceNote).toBeUndefined();
    });
  });
});
