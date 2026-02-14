import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers/layout/layout-diagram';
import { handleImportXml } from '../../../src/handlers/core/import-xml';
import { handleExportBpmn } from '../../../src/handlers/core/export';
import { handleValidate } from '../../../src/handlers/core/validate';
import {
  repairMissingDiShapes,
  deduplicateDiInModeler,
} from '../../../src/handlers/layout/layout-helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { parseResult, clearDiagrams, createDiagram, addElement } from '../../helpers';

/** BPMN XML with a task and flow in the process but missing DI entries. */
const XML_MISSING_DI = [
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
  '    </bpmndi:BPMNPlane>',
  '  </bpmndi:BPMNDiagram>',
  '</bpmn:definitions>',
].join('\n');

describe('DI repair: repairMissingDiShapes', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('repairs missing BPMNShape and BPMNEdge before layout', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: XML_MISSING_DI, autoLayout: false })
    );
    const diagramId = importRes.diagramId;
    const diagram = getDiagram(diagramId)!;

    // Before repair: Task_Ghost should not be in element registry
    const regBefore = diagram.modeler.get('elementRegistry');
    expect(regBefore.get('Task_Ghost')).toBeFalsy();

    // Run repair
    const repairs = await repairMissingDiShapes(diagram);
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs.some((r: string) => r.includes('Ghost Task'))).toBe(true);

    // After repair: Task_Ghost should be in element registry
    const regAfter = diagram.modeler.get('elementRegistry');
    expect(regAfter.get('Task_Ghost')).toBeTruthy();
  });

  test('returns empty array when no DI shapes are missing', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const diagram = getDiagram(diagramId)!;
    const repairs = await repairMissingDiShapes(diagram);
    expect(repairs).toHaveLength(0);
  });

  test('layout repairs missing DI shapes automatically', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: XML_MISSING_DI, autoLayout: false })
    );
    const diagramId = importRes.diagramId;

    // Run layout — should repair and lay out the missing elements
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);

    // After layout, all elements should be positioned
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const taskEl = reg.get('Task_Ghost');
    expect(taskEl).toBeTruthy();
    expect(taskEl.x).toBeDefined();
    expect(taskEl.y).toBeDefined();
  });

  test('repaired elements appear in exported XML', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: XML_MISSING_DI, autoLayout: false })
    );
    const diagramId = importRes.diagramId;

    // Layout triggers repair + export
    await handleLayoutDiagram({ diagramId });
    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = exportRes.content[0].text;

    // The exported XML should contain DI for Task_Ghost
    expect(xml).toContain('bpmnElement="Task_Ghost"');
  });

  test('repaired diagram has no missing-di-shape lint warnings', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: XML_MISSING_DI, autoLayout: false })
    );
    const diagramId = importRes.diagramId;

    // Before repair, lint should warn about missing DI
    const lintBefore = parseResult(await handleValidate({ diagramId }));
    const beforeIssues = lintBefore.issues.filter(
      (i: any) => i.rule === 'bpmn-mcp/missing-di-shape'
    );
    expect(beforeIssues.length).toBeGreaterThan(0);

    // Layout repairs, then lint should have no missing-di-shape warnings
    await handleLayoutDiagram({ diagramId });
    const lintAfter = parseResult(await handleValidate({ diagramId }));
    const afterIssues = lintAfter.issues.filter((i: any) => i.rule === 'bpmn-mcp/missing-di-shape');
    expect(afterIssues).toHaveLength(0);
  });
});

describe('DI deduplication: deduplicateDiInModeler', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('removes duplicate DI plane entries', async () => {
    // Create a diagram with duplicate BPMNShape in XML
    const xmlWithDupes = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
      '                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
      '                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
      '                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
      '                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">',
      '  <bpmn:process id="Process_1" isExecutable="true">',
      '    <bpmn:startEvent id="StartEvent_1" />',
      '  </bpmn:process>',
      '  <bpmndi:BPMNDiagram id="BPMNDiagram_1">',
      '    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">',
      '      <bpmndi:BPMNShape id="StartEvent_1_di_old" bpmnElement="StartEvent_1">',
      '        <dc:Bounds x="100" y="100" width="36" height="36" />',
      '      </bpmndi:BPMNShape>',
      '      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">',
      '        <dc:Bounds x="200" y="200" width="36" height="36" />',
      '      </bpmndi:BPMNShape>',
      '    </bpmndi:BPMNPlane>',
      '  </bpmndi:BPMNDiagram>',
      '</bpmn:definitions>',
    ].join('\n');

    const importRes = parseResult(await handleImportXml({ xml: xmlWithDupes, autoLayout: false }));
    const diagramId = importRes.diagramId;
    const diagram = getDiagram(diagramId)!;

    const removed = deduplicateDiInModeler(diagram);
    expect(removed).toBe(1);
  });

  test('returns 0 when no duplicates exist', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const diagram = getDiagram(diagramId)!;
    const removed = deduplicateDiInModeler(diagram);
    expect(removed).toBe(0);
  });
});
