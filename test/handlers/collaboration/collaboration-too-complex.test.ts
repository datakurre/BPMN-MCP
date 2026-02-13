/**
 * Tests for collaboration-too-complex lint rule.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate, handleCreateCollaboration } from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';

describe('collaboration-too-complex lint rule', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when collaboration has >3 participants', async () => {
    const diagramId = await createDiagram('complex-collab');

    await handleCreateCollaboration({
      diagramId,
      participants: [
        { name: 'Main Process' },
        { name: 'Partner A', collapsed: true },
        { name: 'Partner B', collapsed: true },
        { name: 'Partner C', collapsed: true },
        { name: 'Partner D', collapsed: true },
      ],
    });

    const res = parseResult(
      await handleValidate({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/collaboration-too-complex': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/collaboration-too-complex');
    // Should warn about >3 participants (5 participants)
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const participantIssue = issues.find((i: any) => i.message.includes('participants'));
    expect(participantIssue).toBeDefined();
    expect(participantIssue.message).toContain('5 participants');
  });

  test('no warning for collaboration with <=3 participants', async () => {
    const diagramId = await createDiagram('simple-collab');

    await handleCreateCollaboration({
      diagramId,
      participants: [{ name: 'Main Process' }, { name: 'Partner', collapsed: true }],
    });

    const res = parseResult(
      await handleValidate({
        diagramId,
        config: {
          rules: { 'bpmn-mcp/collaboration-too-complex': 'warn' },
        },
      })
    );

    const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/collaboration-too-complex');
    expect(issues.length).toBe(0);
  });
});
