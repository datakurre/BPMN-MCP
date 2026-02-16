import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleImportXml, handleExportBpmn } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

/** BPMN XML with a collapsed subprocess (separate BPMNDiagram/BPMNPlane for
 *  drill-down) containing internal flow.  This simulates what bpmn-auto-layout
 *  can produce for subprocesses. */
const COLLAPSED_SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start">
      <bpmn:outgoing>Flow1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:subProcess id="Sub1" name="My Subprocess">
      <bpmn:incoming>Flow1</bpmn:incoming>
      <bpmn:outgoing>Flow2</bpmn:outgoing>
      <bpmn:startEvent id="SubStart">
        <bpmn:outgoing>SubFlow1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:userTask id="SubTask" name="Do Work">
        <bpmn:incoming>SubFlow1</bpmn:incoming>
        <bpmn:outgoing>SubFlow2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="SubEnd">
        <bpmn:incoming>SubFlow2</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="SubFlow1" sourceRef="SubStart" targetRef="SubTask" />
      <bpmn:sequenceFlow id="SubFlow2" sourceRef="SubTask" targetRef="SubEnd" />
    </bpmn:subProcess>
    <bpmn:endEvent id="End">
      <bpmn:incoming>Flow2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow1" sourceRef="Start" targetRef="Sub1" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="Sub1" targetRef="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub1_di" bpmnElement="Sub1" isExpanded="false">
        <dc:Bounds x="200" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End">
        <dc:Bounds x="400" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Sub1">
    <bpmndi:BPMNPlane id="BPMNPlane_Sub1" bpmnElement="Sub1">
      <bpmndi:BPMNShape id="SubStart_di" bpmnElement="SubStart">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="SubTask_di" bpmnElement="SubTask">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="SubEnd_di" bpmnElement="SubEnd">
        <dc:Bounds x="400" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('layout_bpmn_diagram — expandSubprocesses option', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('collapsed subprocess stays collapsed by default', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: COLLAPSED_SUBPROCESS_XML, autoLayout: false })
    );
    expect(importRes.success).toBe(true);
    const diagramId = importRes.diagramId;

    // Verify subprocess starts collapsed
    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const sub = registry.get('Sub1');
    expect(sub.di?.isExpanded).toBe(false);

    // Layout without expandSubprocesses
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutRes.success).toBe(true);
    expect(layoutRes.subprocessesExpanded).toBeUndefined();
  });

  test('expandSubprocesses: true expands collapsed subprocess with internal flow', async () => {
    const importRes = parseResult(
      await handleImportXml({ xml: COLLAPSED_SUBPROCESS_XML, autoLayout: false })
    );
    expect(importRes.success).toBe(true);
    const diagramId = importRes.diagramId;

    // Layout with expandSubprocesses: true
    const layoutRes = parseResult(
      await handleLayoutDiagram({ diagramId, expandSubprocesses: true })
    );
    expect(layoutRes.success).toBe(true);
    expect(layoutRes.subprocessesExpanded).toBeGreaterThanOrEqual(1);

    // Export and verify subprocess is now expanded
    const xml = (await handleExportBpmn({ diagramId, format: 'xml', skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('isExpanded="true"');
  });

  test('expandSubprocesses does not affect event subprocesses', async () => {
    const EVENT_SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start">
      <bpmn:outgoing>Flow1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="End">
      <bpmn:incoming>Flow1</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow1" sourceRef="Start" targetRef="End" />
    <bpmn:subProcess id="EventSub" triggeredByEvent="true">
      <bpmn:startEvent id="EventSubStart" isInterrupting="false">
        <bpmn:timerEventDefinition>
          <bpmn:timeDuration>PT1H</bpmn:timeDuration>
        </bpmn:timerEventDefinition>
        <bpmn:outgoing>EventSubFlow</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:endEvent id="EventSubEnd">
        <bpmn:incoming>EventSubFlow</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="EventSubFlow" sourceRef="EventSubStart" targetRef="EventSubEnd" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End">
        <dc:Bounds x="300" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EventSub_di" bpmnElement="EventSub" isExpanded="false">
        <dc:Bounds x="100" y="250" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="BPMNDiagram_EventSub">
    <bpmndi:BPMNPlane id="BPMNPlane_EventSub" bpmnElement="EventSub">
      <bpmndi:BPMNShape id="EventSubStart_di" bpmnElement="EventSubStart">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EventSubEnd_di" bpmnElement="EventSubEnd">
        <dc:Bounds x="300" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(
      await handleImportXml({ xml: EVENT_SUBPROCESS_XML, autoLayout: false })
    );
    const diagramId = importRes.diagramId;

    // Layout with expandSubprocesses — event subprocess should NOT be expanded
    const layoutRes = parseResult(
      await handleLayoutDiagram({ diagramId, expandSubprocesses: true })
    );
    expect(layoutRes.success).toBe(true);
    // Event subprocess should not be counted (triggeredByEvent is skipped)
    expect(layoutRes.subprocessesExpanded).toBeUndefined();
  });

  test('expandSubprocesses has no effect when subprocesses are already expanded', async () => {
    const EXPANDED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start">
      <bpmn:outgoing>Flow1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:subProcess id="Sub1" name="Already Expanded">
      <bpmn:incoming>Flow1</bpmn:incoming>
      <bpmn:outgoing>Flow2</bpmn:outgoing>
      <bpmn:startEvent id="SubStart">
        <bpmn:outgoing>SubFlow1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:endEvent id="SubEnd">
        <bpmn:incoming>SubFlow1</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="SubFlow1" sourceRef="SubStart" targetRef="SubEnd" />
    </bpmn:subProcess>
    <bpmn:endEvent id="End">
      <bpmn:incoming>Flow2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow1" sourceRef="Start" targetRef="Sub1" />
    <bpmn:sequenceFlow id="Flow2" sourceRef="Sub1" targetRef="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub1_di" bpmnElement="Sub1" isExpanded="true">
        <dc:Bounds x="200" y="100" width="350" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="SubStart_di" bpmnElement="SubStart">
        <dc:Bounds x="230" y="182" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="SubEnd_di" bpmnElement="SubEnd">
        <dc:Bounds x="460" y="182" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End">
        <dc:Bounds x="620" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml: EXPANDED_XML, autoLayout: false }));
    const diagramId = importRes.diagramId;

    const layoutRes = parseResult(
      await handleLayoutDiagram({ diagramId, expandSubprocesses: true })
    );
    expect(layoutRes.success).toBe(true);
    // No subprocesses needed expanding — they were already expanded
    expect(layoutRes.subprocessesExpanded).toBeUndefined();
  });
});
