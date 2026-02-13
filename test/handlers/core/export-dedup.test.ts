/**
 * Tests for DI element deduplication in export_bpmn.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleExportBpmn } from '../../../src/handlers/core/export';
import { handleImportXml } from '../../../src/handlers';
import { clearDiagrams } from '../../../src/diagram-manager';
import { parseResult, createDiagram, addElement } from '../../helpers';

afterEach(() => clearDiagrams());

describe('export_bpmn — DI deduplication', () => {
  test('should not produce duplicate BPMNShape ids in normal flow', async () => {
    const diagramId = await createDiagram('dedup-test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    const result = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = result.content[0].text;

    // Count BPMNShape occurrences for each element
    const shapeMatches = xml.match(/bpmndi:BPMNShape\s+id="[^"]+"/g) || [];
    const shapeIds = shapeMatches.map((m: string) => m.match(/id="([^"]+)"/)?.[1]);
    const uniqueIds = new Set(shapeIds);

    // All shape IDs should be unique
    expect(shapeIds.length).toBe(uniqueIds.size);
  });

  test('should remove duplicate DI elements from XML', async () => {
    // Create a diagram and import XML that contains duplicate DI shapes
    const xmlWithDuplicates = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
    <bpmn:userTask id="UserTask_Review" name="Review" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="UserTask_Review" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="UserTask_Review_di" bpmnElement="UserTask_Review">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <dc:Bounds x="136" y="118" width="64" height="0" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importResult = parseResult(await handleImportXml({ xml: xmlWithDuplicates }));
    const diagramId = importResult.diagramId;

    const result = await handleExportBpmn({
      diagramId,
      format: 'xml',
      skipLint: true,
    });
    const xml = result.content[0].text;

    // Count BPMNShape occurrences — should have no duplicate IDs
    const shapeMatches = xml.match(/bpmndi:BPMNShape\s+id="[^"]+"/g) || [];
    const shapeIds = shapeMatches.map((m: string) => m.match(/id="([^"]+)"/)?.[1]);
    const uniqueIds = new Set(shapeIds);
    expect(shapeIds.length).toBe(uniqueIds.size);
  });
});
