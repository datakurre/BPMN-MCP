/**
 * bpmnlint rules tests — lane and collaboration validation rules.
 *
 * Renamed from: new-lane-rules.test.ts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleCreateCollaboration,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connectAll } from '../../helpers';

/**
 * Tests for new lane-related bpmnlint rules:
 * - lane-crossing-excessive
 * - lane-single-element
 * - lane-missing-start-or-end
 */

describe('new lane lint rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── lane-crossing-excessive ──────────────────────────────────────────────

  describe('lane-crossing-excessive', () => {
    test('warns when majority of flows cross lane boundaries', async () => {
      const diagramId = await createDiagram('Excessive Crossings');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      // Create a flow that alternates between lanes heavily:
      // A → B → A → B → A (4 out of 4 flows cross lanes = 100%)
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 1',
        laneId: laneB,
      });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 2',
        laneId: laneA,
      });
      const t3 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 3',
        laneId: laneB,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneA,
      });

      await connectAll(diagramId, start, t1, t2, t3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-crossing-excessive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-crossing-excessive');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('cross lane boundaries');
    });

    test('does not warn when most flows stay within lanes', async () => {
      const diagramId = await createDiagram('Few Crossings');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      // 3 flows in lane A, 1 cross to B — 25% crossing, below threshold
      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 1',
        laneId: laneA,
      });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 2',
        laneId: laneA,
      });
      const t3 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 3',
        laneId: laneA,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneB,
      });

      await connectAll(diagramId, start, t1, t2, t3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-crossing-excessive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-crossing-excessive');
      expect(issues).toHaveLength(0);
    });

    test('does not warn for processes without lanes', async () => {
      const diagramId = await createDiagram('No Lanes');

      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
      const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 3' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, t1, t2, t3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-crossing-excessive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-crossing-excessive');
      expect(issues).toHaveLength(0);
    });
  });

  // ── lane-single-element ──────────────────────────────────────────────────

  // ── lane-missing-start-or-end ────────────────────────────────────────────

  describe('lane-missing-start-or-end', () => {
    test('warns when no lane contains a start event', async () => {
      const diagramId = await createDiagram('Missing Start');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      // Only tasks and an end event in lanes, no start event assigned
      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 1',
        laneId: laneA,
      });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 2',
        laneId: laneB,
      });
      const t3 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 3',
        laneId: laneA,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneB,
      });

      await connectAll(diagramId, t1, t2, t3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-missing-start-or-end': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-missing-start-or-end');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('start event');
    });

    test('does not warn when lanes have start and end events', async () => {
      const diagramId = await createDiagram('Complete');

      const collResult = parseResult(
        await handleCreateCollaboration({
          diagramId,
          participants: [
            { name: 'Organization', width: 1200, height: 600 },
            { name: 'External', collapsed: true },
          ],
        })
      );

      const poolId = collResult.participantIds[0];

      const laneA = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team A',
        participantId: poolId,
      });
      const laneB = await addElement(diagramId, 'bpmn:Lane', {
        name: 'Team B',
        participantId: poolId,
      });

      const start = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Start',
        laneId: laneA,
      });
      const t1 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 1',
        laneId: laneA,
      });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 2',
        laneId: laneB,
      });
      const t3 = await addElement(diagramId, 'bpmn:UserTask', {
        name: 'Task 3',
        laneId: laneB,
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'End',
        laneId: laneB,
      });

      await connectAll(diagramId, start, t1, t2, t3, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-missing-start-or-end': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-missing-start-or-end');
      expect(issues).toHaveLength(0);
    });

    test('does not warn for processes without lanes', async () => {
      const diagramId = await createDiagram('No Lanes');

      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/lane-missing-start-or-end': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/lane-missing-start-or-end');
      expect(issues).toHaveLength(0);
    });
  });
});
