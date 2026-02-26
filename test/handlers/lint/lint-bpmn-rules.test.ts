/**
 * bpmnlint rules tests — flow, gateway, subprocess, boundary, and task validation rules.
 *
 * Merged from: new-lint-rules.test.ts, new-rules-batch2.test.ts, new-rules-batch3.test.ts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleValidate as handleLintDiagram,
  handleSetProperties,
  handleSetEventDefinition,
  handleImportXml,
} from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  clearDiagrams,
  connect,
  connectAll,
} from '../../helpers';

describe('bpmnlint new rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('compensation-missing-association', () => {
    test('errors when compensation boundary event has no association to handler', async () => {
      const diagramId = await createDiagram('Compensation Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      // Add compensation boundary event (without association)
      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Compensation',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      // Add handler marked isForCompensation but not associated
      const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Refund' });
      await handleSetProperties({
        diagramId,
        elementId: handler,
        properties: { isForCompensation: true },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/compensation-missing-association': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/compensation-missing-association'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('association');
    });
  });

  describe('boundary-event-scope', () => {
    test('warns when message boundary event leads to cancellation path', async () => {
      const diagramId = await createDiagram('Scope Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Details' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, end);

      // Add message boundary event
      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Cancel',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Msg_Cancel', name: 'Cancel Message' },
      });

      // Add compensation throw after boundary (terminal path)
      const compThrow = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', {
        name: 'Compensate',
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: compThrow,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      const cancelEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Registration Cancelled',
      });
      await connectAll(diagramId, boundaryEvent, compThrow, cancelEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/boundary-event-scope': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/boundary-event-scope');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('event subprocess');
    });

    test('does not warn for timer boundary events', async () => {
      const diagramId = await createDiagram('Timer Boundary');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Wait Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, end);

      const boundaryEvent = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryEvent,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
      await connect(diagramId, boundaryEvent, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/boundary-event-scope': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/boundary-event-scope');
      expect(issues.length).toBe(0);
    });
  });

  describe('loop-without-limit', () => {
    test('warns when a loop has no limiting mechanism', async () => {
      const diagramId = await createDiagram('Unlimited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      // Loop back without any limiting mechanism
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('limiting mechanism');
    });

    test('does not warn when loop has a timer boundary event', async () => {
      const diagramId = await createDiagram('Limited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      // Add timer boundary event (acts as loop limiter)
      const timerBound = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBound,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT30M' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Timed Out' });
      await connect(diagramId, timerBound, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBe(0);
    });

    test('does not warn when loop has a script task (counter)', async () => {
      const diagramId = await createDiagram('Counter Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const counter = await addElement(diagramId, 'bpmn:ScriptTask', {
        name: 'Increment Counter',
      });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connectAll(diagramId, start, task, counter, gw);
      await connect(diagramId, gw, end, { isDefault: true });
      // Loop back through the counter script
      await connect(diagramId, gw, task, { conditionExpression: '${!valid}', label: 'No' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/loop-without-limit': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/loop-without-limit');
      expect(issues.length).toBe(0);
    });
  });

  describe('exclusive-gateway-conditions', () => {
    test('errors when gateway has mixed conditional/unconditional flows with no default', async () => {
      const diagramId = await createDiagram('Mixed Conditions');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      // Second flow has no condition and is not set as default
      await connect(diagramId, gw, taskB);
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('default');
    });

    test('does not error when all flows have conditions', async () => {
      const diagramId = await createDiagram('All Conditions');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      await connect(diagramId, gw, taskB, { conditionExpression: '${!approved}' });
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBe(0);
    });

    test('does not error when unconditional flow is set as default', async () => {
      const diagramId = await createDiagram('With Default');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${approved}' });
      await connect(diagramId, gw, taskB, { isDefault: true });
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBe(0);
    });

    test('errors when multiple flows lack conditions', async () => {
      const diagramId = await createDiagram('Multiple Uncond');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Route?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Path A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Path B' });
      const taskC = await addElement(diagramId, 'bpmn:Task', { name: 'Path C' });

      await connect(diagramId, start, gw);
      await connect(diagramId, gw, taskA, { conditionExpression: '${route == "A"}' });
      // Two flows without conditions
      await connect(diagramId, gw, taskB);
      await connect(diagramId, gw, taskC);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/exclusive-gateway-conditions': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/exclusive-gateway-conditions'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('without conditions');
    });
  });

  describe('compensation-missing-association (orphaned handler)', () => {
    test('errors when compensation handler has no association from boundary event', async () => {
      const diagramId = await createDiagram('Orphaned Handler');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Charge Card' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await connectAll(diagramId, start, task, end);

      // Create a handler with isForCompensation=true but no boundary event at all
      const handler = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Refund Card' });
      await handleSetProperties({
        diagramId,
        elementId: handler,
        properties: { isForCompensation: true },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/compensation-missing-association': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/compensation-missing-association'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i: any) => i.message.includes('not connected'))).toBe(true);
    });
  });

  describe('parallel-gateway-merge-exclusive', () => {
    test('warns when parallel gateway merges exclusive gateway branches', async () => {
      const diagramId = await createDiagram('Parallel Merges Exclusive');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const xgw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Approved?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Accept' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Reject' });
      const pjoin = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Merge' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, xgw);
      await connect(diagramId, xgw, taskA);
      await connect(diagramId, xgw, taskB);
      await connect(diagramId, taskA, pjoin);
      await connect(diagramId, taskB, pjoin);
      await connect(diagramId, pjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('deadlock');
    });

    test('does not warn when parallel gateway merges parallel gateway branches', async () => {
      const diagramId = await createDiagram('Parallel Merges Parallel');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const psplit = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const pjoin = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, psplit);
      await connect(diagramId, psplit, taskA);
      await connect(diagramId, psplit, taskB);
      await connect(diagramId, taskA, pjoin);
      await connect(diagramId, taskB, pjoin);
      await connect(diagramId, pjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn for exclusive merge after exclusive split', async () => {
      const diagramId = await createDiagram('Exclusive Merges Exclusive');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const xsplit = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Route?' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Path A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Path B' });
      const xjoin = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, xsplit);
      await connect(diagramId, xsplit, taskA);
      await connect(diagramId, xsplit, taskB);
      await connect(diagramId, taskA, xjoin);
      await connect(diagramId, taskB, xjoin);
      await connect(diagramId, xjoin, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/parallel-gateway-merge-exclusive': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/parallel-gateway-merge-exclusive'
      );
      expect(issues.length).toBe(0);
    });
  });

  describe('user-task-missing-assignee', () => {
    test('warns when user task has no assignee or candidates', async () => {
      const diagramId = await createDiagram('No Assignee');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('assignee');
    });

    test('does not warn when user task has camunda:assignee', async () => {
      const diagramId = await createDiagram('Has Assignee');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:assignee': 'john' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn when user task has camunda:candidateGroups', async () => {
      const diagramId = await createDiagram('Has Candidates');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:candidateGroups': 'managers' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });

    test('does not warn for non-user tasks', async () => {
      const diagramId = await createDiagram('Service Task');
      await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/user-task-missing-assignee': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/user-task-missing-assignee'
      );
      expect(issues.length).toBe(0);
    });
  });

  describe('implicit-merge', () => {
    test('errors when activity has multiple incoming flows without merge gateway', async () => {
      const diagramId = await createDiagram('Implicit Merge');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const target = await addElement(diagramId, 'bpmn:Task', { name: 'Process' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, taskA);
      await connect(diagramId, start, taskB);
      await connect(diagramId, taskA, target);
      await connect(diagramId, taskB, target);
      await connect(diagramId, target, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('merge gateway');
    });

    test('errors when end event has multiple incoming flows', async () => {
      const diagramId = await createDiagram('Implicit Merge End');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, taskA);
      await connect(diagramId, start, taskB);
      await connect(diagramId, taskA, end);
      await connect(diagramId, taskB, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('End event');
    });

    test('does not error when using explicit merge gateway', async () => {
      const diagramId = await createDiagram('Explicit Merge');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
      const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
      const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
      const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, split);
      await connect(diagramId, split, taskA);
      await connect(diagramId, split, taskB);
      await connect(diagramId, taskA, join);
      await connect(diagramId, taskB, join);
      await connect(diagramId, join, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBe(0);
    });

    test('does not error for single incoming flow', async () => {
      const diagramId = await createDiagram('Single Incoming');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:Task', { name: 'Process' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await connect(diagramId, start, task);
      await connect(diagramId, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            extends: 'plugin:bpmn-mcp/recommended',
            rules: { 'bpmn-mcp/implicit-merge': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/implicit-merge');
      expect(issues.length).toBe(0);
    });
  });
});

describe('New bpmnlint rules (pool-size, message-flow, alignment, grouping)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── pool-size-insufficient ───────────────────────────────────────────

  describe('pool-size-insufficient', () => {
    test('warns when pool is too small for contained elements', async () => {
      // Import a diagram with a deliberately small pool containing many elements
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Small Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:userTask id="Task_1" name="Task 1" />
    <bpmn:userTask id="Task_2" name="Task 2" />
    <bpmn:endEvent id="End_1" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="200" height="100" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="120" y="120" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="110" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="350" y="110" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="120" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const importRes = parseResult(await handleImportXml({ xml }));
      const diagramId = importRes.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/pool-size-insufficient': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/pool-size-insufficient');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('too small');
    });

    test('does not fire when pool is large enough', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Big Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:endEvent id="End_1" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="800" height="300" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="200" y="220" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="220" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const importRes = parseResult(await handleImportXml({ xml }));
      const diagramId = importRes.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/pool-size-insufficient': 'warn' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/pool-size-insufficient');
      expect(issues.length).toBe(0);
    });
  });

  // ── message-flow-necessity ───────────────────────────────────────────

  // ── unaligned-message-events ─────────────────────────────────────────

  // ── inconsistent-assignee-grouping ───────────────────────────────────

  describe('inconsistent-assignee-grouping', () => {
    test('warns when same assignee appears in multiple lanes', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Support" name="Support">
        <bpmn:flowNodeRef>Task_Review</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Manager">
        <bpmn:flowNodeRef>Task_Escalate</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Also_Support</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_Review" name="Review Ticket" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_Escalate" name="Escalate Issue" camunda:assignee="manager" />
    <bpmn:userTask id="Task_Also_Support" name="Follow Up" camunda:assignee="support-agent" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="400" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Support_di" bpmnElement="Lane_Support" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Manager_di" bpmnElement="Lane_Manager" isHorizontal="true">
        <dc:Bounds x="30" y="200" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="100" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Escalate_di" bpmnElement="Task_Escalate">
        <dc:Bounds x="100" y="260" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Also_Support_di" bpmnElement="Task_Also_Support">
        <dc:Bounds x="250" y="260" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const importRes = parseResult(await handleImportXml({ xml }));
      const diagramId = importRes.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('support-agent');
      expect(issues[0].message).toContain('spread across');
    });

    test('does not fire when each assignee is in one lane', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Support" name="Support">
        <bpmn:flowNodeRef>Task_Review</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_FollowUp</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Manager">
        <bpmn:flowNodeRef>Task_Approve</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_Review" name="Review Ticket" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_FollowUp" name="Follow Up" camunda:assignee="support-agent" />
    <bpmn:userTask id="Task_Approve" name="Approve" camunda:assignee="manager" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="400" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Support_di" bpmnElement="Lane_Support" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Manager_di" bpmnElement="Lane_Manager" isHorizontal="true">
        <dc:Bounds x="30" y="200" width="570" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Review_di" bpmnElement="Task_Review">
        <dc:Bounds x="100" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_FollowUp_di" bpmnElement="Task_FollowUp">
        <dc:Bounds x="250" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve">
        <dc:Bounds x="100" y="260" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      const importRes = parseResult(await handleImportXml({ xml }));
      const diagramId = importRes.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBe(0);
    });

    test('does not fire when process has no lanes', async () => {
      const diagramId = await createDiagram('No Lanes');
      const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
      const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task B' });

      await handleSetProperties({
        diagramId,
        elementId: t1,
        properties: { 'camunda:assignee': 'admin' },
      });
      await handleSetProperties({
        diagramId,
        elementId: t2,
        properties: { 'camunda:assignee': 'admin' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/inconsistent-assignee-grouping': 'warn' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/inconsistent-assignee-grouping'
      );
      expect(issues.length).toBe(0);
    });
  });
});

/**
 * Tests for new bpmnlint rules:
 * - service-task-missing-implementation
 * - timer-missing-definition
 * - call-activity-missing-called-element
 * - event-subprocess-missing-trigger
 * - empty-subprocess
 * - dangling-boundary-event
 * - receive-task-missing-message
 */
describe('bpmnlint new rules batch 3', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── service-task-missing-implementation ────────────────────────────────

  describe('service-task-missing-implementation', () => {
    test('warns when service task has no implementation', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no implementation');
    });

    test('passes when service task has camunda:class', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:class': 'com.example.ProcessOrder' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:expression', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:expression': '${orderService.process(execution)}' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:type=external with topic', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:type': 'external', 'camunda:topic': 'process-order' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });

    test('passes when service task has camunda:delegateExpression', async () => {
      const diagramId = await createDiagram('Service Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Process Order',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      await handleSetProperties({
        diagramId,
        elementId: task,
        properties: { 'camunda:delegateExpression': '${orderDelegate}' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/service-task-missing-implementation': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/service-task-missing-implementation'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── timer-missing-definition ──────────────────────────────────────────

  describe('timer-missing-definition', () => {
    test('warns when timer event has no duration/date/cycle', async () => {
      // Import XML with a timer boundary event that has no timer properties
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="true">
    <startEvent id="Start" name="Start">
      <outgoing>Flow_1</outgoing>
    </startEvent>
    <userTask id="Task_1" name="Do Something">
      <incoming>Flow_1</incoming>
      <outgoing>Flow_2</outgoing>
    </userTask>
    <endEvent id="End" name="End">
      <incoming>Flow_2</incoming>
    </endEvent>
    <boundaryEvent id="Timer_1" name="Timeout" attachedToRef="Task_1">
      <outgoing>Flow_3</outgoing>
      <timerEventDefinition id="TimerDef_1" />
    </boundaryEvent>
    <endEvent id="End_Timeout" name="Timed Out">
      <incoming>Flow_3</incoming>
    </endEvent>
    <sequenceFlow id="Flow_1" sourceRef="Start" targetRef="Task_1" />
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End" />
    <sequenceFlow id="Flow_3" sourceRef="Timer_1" targetRef="End_Timeout" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="180" y="200" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="280" y="178" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End"><dc:Bounds x="450" y="200" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Timer_1_di" bpmnElement="Timer_1"><dc:Bounds x="312" y="240" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Timeout_di" bpmnElement="End_Timeout"><dc:Bounds x="312" y="320" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="216" y="218" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="280" y="218" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="380" y="218" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="450" y="218" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="330" y="276" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="330" y="320" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;
      const importResult = parseResult(await handleImportXml({ xml }));
      const diagramId = importResult.diagramId;

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('timeDuration');
    });

    test('passes when timer event has timeDuration', async () => {
      const diagramId = await createDiagram('Timer Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Something' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timeout',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT15M' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Timed Out',
      });
      await connect(diagramId, timerBE, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(0);
    });

    test('passes when timer start event has timeCycle', async () => {
      const diagramId = await createDiagram('Timer Start Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Every 10 min' });
      await handleSetEventDefinition({
        diagramId,
        elementId: start,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeCycle: 'R/PT10M' },
      });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
      await connectAll(diagramId, start, task, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/timer-missing-definition': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/timer-missing-definition');
      expect(issues.length).toBe(0);
    });
  });

  // ── call-activity-missing-called-element ──────────────────────────────

  describe('call-activity-missing-called-element', () => {
    test('warns when call activity has no calledElement', async () => {
      const diagramId = await createDiagram('Call Activity Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const callAct = await addElement(diagramId, 'bpmn:CallActivity', {
        name: 'Call Sub Process',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, callAct, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/call-activity-missing-called-element': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/call-activity-missing-called-element'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('calledElement');
    });

    test('passes when call activity has calledElement', async () => {
      const diagramId = await createDiagram('Call Activity Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const callAct = await addElement(diagramId, 'bpmn:CallActivity', {
        name: 'Call Sub Process',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, callAct, end);

      await handleSetProperties({
        diagramId,
        elementId: callAct,
        properties: { calledElement: 'my-sub-process' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/call-activity-missing-called-element': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/call-activity-missing-called-element'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── event-subprocess-missing-trigger ──────────────────────────────────

  describe('event-subprocess-missing-trigger', () => {
    test('errors when event subprocess start has no event definition', async () => {
      const diagramId = await createDiagram('Event Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Create event subprocess
      const eventSub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Error Handler',
      });
      await handleSetProperties({
        diagramId,
        elementId: eventSub,
        properties: { triggeredByEvent: true, isExpanded: true },
      });

      // Add blank start event (no event definition) inside the event subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Handler Start',
        participantId: eventSub,
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Handler End',
        participantId: eventSub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/event-subprocess-missing-trigger': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/event-subprocess-missing-trigger'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no event definition');
    });

    test('passes when event subprocess start has error event definition', async () => {
      const diagramId = await createDiagram('Event Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Create event subprocess
      const eventSub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Error Handler',
      });
      await handleSetProperties({
        diagramId,
        elementId: eventSub,
        properties: { triggeredByEvent: true, isExpanded: true },
      });

      // Add start event with error definition inside the event subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Error Caught',
        participantId: eventSub,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: subStart,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Handler End',
        participantId: eventSub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/event-subprocess-missing-trigger': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/event-subprocess-missing-trigger'
      );
      expect(issues.length).toBe(0);
    });
  });

  // ── empty-subprocess ──────────────────────────────────────────────────

  describe('empty-subprocess', () => {
    test('warns when expanded subprocess has no flow elements', async () => {
      const diagramId = await createDiagram('Empty Subprocess Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const sub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Empty Sub',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, sub, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/empty-subprocess': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/empty-subprocess');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no flow elements');
    });

    test('passes when subprocess has flow elements', async () => {
      const diagramId = await createDiagram('Subprocess With Content');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const sub = await addElement(diagramId, 'bpmn:SubProcess', {
        name: 'Active Sub',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, sub, end);

      // Add content inside subprocess
      const subStart = await addElement(diagramId, 'bpmn:StartEvent', {
        name: 'Sub Start',
        participantId: sub,
      });
      const subEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Sub End',
        participantId: sub,
      });
      await connect(diagramId, subStart, subEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/empty-subprocess': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/empty-subprocess');
      expect(issues.length).toBe(0);
    });
  });

  // ── dangling-boundary-event ───────────────────────────────────────────

  describe('dangling-boundary-event', () => {
    test('warns when boundary event has no outgoing flow', async () => {
      const diagramId = await createDiagram('Dangling Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Add timer boundary event without outgoing flow
      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timer',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no outgoing sequence flow');
    });

    test('passes when boundary event has outgoing flow', async () => {
      const diagramId = await createDiagram('Connected Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Work' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      const timerBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Timer',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: timerBE,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        properties: { timeDuration: 'PT1H' },
      });

      const timeoutEnd = await addElement(diagramId, 'bpmn:EndEvent', {
        name: 'Timed Out',
      });
      await connect(diagramId, timerBE, timeoutEnd);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(0);
    });

    test('skips compensation boundary events', async () => {
      const diagramId = await createDiagram('Compensation Boundary Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: 'Charge Card',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, task, end);

      // Compensation boundary event — these use associations, not sequence flows
      const compBE = await addElement(diagramId, 'bpmn:BoundaryEvent', {
        name: 'Compensate',
        hostElementId: task,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: compBE,
        eventDefinitionType: 'bpmn:CompensateEventDefinition',
      });

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/dangling-boundary-event': 'error' },
          },
        })
      );

      const issues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/dangling-boundary-event');
      expect(issues.length).toBe(0);
    });
  });

  // ── receive-task-missing-message ──────────────────────────────────────

  describe('receive-task-missing-message', () => {
    test('warns when receive task has no message reference', async () => {
      const diagramId = await createDiagram('Receive Task Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const recvTask = await addElement(diagramId, 'bpmn:ReceiveTask', {
        name: 'Wait for Response',
      });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
      await connectAll(diagramId, start, recvTask, end);

      const res = parseResult(
        await handleLintDiagram({
          diagramId,
          config: {
            rules: { 'bpmn-mcp/receive-task-missing-message': 'error' },
          },
        })
      );

      const issues = res.issues.filter(
        (i: any) => i.rule === 'bpmn-mcp/receive-task-missing-message'
      );
      expect(issues.length).toBe(1);
      expect(issues[0].message).toContain('no message reference');
    });
  });
});
