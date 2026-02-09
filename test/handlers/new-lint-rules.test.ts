import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleConnect,
  handleLintDiagram,
  handleSetProperties,
  handleSetEventDefinition,
} from '../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../helpers';

describe('bpmnlint new rules', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('compensation-missing-association', () => {
    it('errors when compensation boundary event has no association to handler', async () => {
      const diagramId = await createDiagram('Compensation Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process Payment' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

      await handleConnect({
        diagramId,
        elementIds: [start, task, end],
      });

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
    it('warns when message boundary event leads to cancellation path', async () => {
      const diagramId = await createDiagram('Scope Test');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Details' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, elementIds: [start, task, end] });

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
      await handleConnect({
        diagramId,
        elementIds: [boundaryEvent, compThrow, cancelEnd],
      });

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

    it('does not warn for timer boundary events', async () => {
      const diagramId = await createDiagram('Timer Boundary');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Wait Task' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, elementIds: [start, task, end] });

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
      await handleConnect({
        diagramId,
        sourceElementId: boundaryEvent,
        targetElementId: timeoutEnd,
      });

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
    it('warns when a loop has no limiting mechanism', async () => {
      const diagramId = await createDiagram('Unlimited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, elementIds: [start, task, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      // Loop back without any limiting mechanism
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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

    it('does not warn when loop has a timer boundary event', async () => {
      const diagramId = await createDiagram('Limited Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, elementIds: [start, task, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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
      await handleConnect({
        diagramId,
        sourceElementId: timerBound,
        targetElementId: timeoutEnd,
      });

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

    it('does not warn when loop has a script task (counter)', async () => {
      const diagramId = await createDiagram('Counter Loop');
      const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
      const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Enter Data' });
      const counter = await addElement(diagramId, 'bpmn:ScriptTask', {
        name: 'Increment Counter',
      });
      const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Valid?' });
      const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

      await handleConnect({ diagramId, elementIds: [start, task, counter, gw] });
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: end,
        isDefault: true,
      });
      // Loop back through the counter script
      await handleConnect({
        diagramId,
        sourceElementId: gw,
        targetElementId: task,
        conditionExpression: '${!valid}',
        label: 'No',
      });

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
});
