import { describe, test, expect, beforeEach } from 'vitest';
import { handleValidate } from '../../../src/handlers/core/validate';
import { handleImportXml } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('bpmnlint rule: missing-di-shape', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('no warnings for a normal diagram with all DI shapes', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do something',
      x: 250,
      y: 100,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { x: 400, y: 100 });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    const res = parseResult(await handleValidate({ diagramId }));
    const diIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/missing-di-shape');
    expect(diIssues).toHaveLength(0);
  });

  test('detects missing DI shape from imported XML with incomplete DI', async () => {
    // BPMN XML with a task in the process but NO BPMNShape for it,
    // and a sequence flow with NO BPMNEdge for it.
    const xmlWithMissingDI = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
      '                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
      '                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
      '                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
      '                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">',
      '  <bpmn:process id="Process_1" isExecutable="true">',
      '    <bpmn:startEvent id="StartEvent_1" />',
      '    <bpmn:task id="Task_Ghost" name="Ghost Task" />',
      '    <bpmn:endEvent id="EndEvent_1" />',
      '    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Ghost" />',
      '    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Ghost" targetRef="EndEvent_1" />',
      '  </bpmn:process>',
      '  <bpmndi:BPMNDiagram id="BPMNDiagram_1">',
      '    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">',
      '      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">',
      '        <dc:Bounds x="100" y="100" width="36" height="36" />',
      '      </bpmndi:BPMNShape>',
      '      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">',
      '        <dc:Bounds x="400" y="100" width="36" height="36" />',
      '      </bpmndi:BPMNShape>',
      '      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">',
      '        <di:waypoint x="136" y="118" />',
      '        <di:waypoint x="250" y="118" />',
      '      </bpmndi:BPMNEdge>',
      '    </bpmndi:BPMNPlane>',
      '  </bpmndi:BPMNDiagram>',
      '</bpmn:definitions>',
    ].join('\n');

    const importRes = parseResult(
      await handleImportXml({ xml: xmlWithMissingDI, autoLayout: false })
    );
    const diagramId = importRes.diagramId;
    expect(diagramId).toBeDefined();

    const res = parseResult(await handleValidate({ diagramId }));
    const diIssues = res.issues.filter((i: any) => i.rule === 'bpmn-mcp/missing-di-shape');

    // Should detect the missing BPMNShape for Task_Ghost
    const shapeIssues = diIssues.filter((i: any) => i.message.includes('BPMNShape'));
    expect(shapeIssues.length).toBeGreaterThanOrEqual(1);
    expect(shapeIssues.some((i: any) => i.message.includes('Ghost Task'))).toBe(true);

    // Should detect the missing BPMNEdge for Flow_2
    const edgeIssues = diIssues.filter((i: any) => i.message.includes('BPMNEdge'));
    expect(edgeIssues.length).toBeGreaterThanOrEqual(1);
  });
});
