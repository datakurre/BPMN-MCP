import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleExportBpmn,
  handleValidate as handleLintDiagram,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('create_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns success with a diagramId', async () => {
    const res = parseResult(await handleCreateDiagram({}));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  test('sets process name when provided', async () => {
    const diagramId = await createDiagram('My Process');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('My Process');
  });

  test('sets a meaningful process id based on the name', async () => {
    const diagramId = await createDiagram('Order Fulfillment');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_Order_Fulfillment"');
    expect(xml).toContain('Order Fulfillment');
  });

  test('does not change process id when no name is provided', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('id="Process_1"');
  });

  test('sets camunda:historyTimeToLive on the process', async () => {
    const diagramId = await createDiagram('HTL Test');
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  test('historyTimeToLive is present even without a name', async () => {
    const diagramId = await createDiagram();
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('camunda:historyTimeToLive="P180D"');
  });

  test('lint does not warn about missing historyTimeToLive on new diagram', async () => {
    const diagramId = await createDiagram('Lint HTL Test');
    const lintRes = parseResult(await handleLintDiagram({ diagramId }));
    const htlIssues = (lintRes.issues || []).filter(
      (i: any) => i.rule && i.rule.includes('history-time-to-live')
    );
    expect(htlIssues).toEqual([]);
  });

  test('workflowContext single-organization recommends create_bpmn_participant with lanes', async () => {
    // Regression for TODO #9: single-org context should suggest lanes in one call
    const res = parseResult(
      await handleCreateDiagram({ workflowContext: 'single-organization', name: 'Order Process' })
    );
    expect(res.workflowContext).toBe('single-organization');
    expect(res.structureGuidance).toContain('lanes');
    // The step should recommend create_bpmn_participant (not create_bpmn_lanes as a follow-up)
    const participantStep = (res.nextSteps ?? []).find(
      (s: any) => s.tool === 'create_bpmn_participant'
    );
    expect(participantStep).toBeDefined();
    expect(participantStep.description).toContain('lanes');
    // Should discourage multiple expanded pools
    const guidance: string = res.structureGuidance ?? '';
    expect(guidance.toLowerCase()).toMatch(/one pool|single pool|one executable/);
  });
});
