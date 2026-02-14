/**
 * Tests for the multiple-expanded-pools bpmnlint rule.
 *
 * Verifies that the rule warns when a collaboration has more than one
 * expanded pool (Camunda 7 / Operaton constraint: only one pool can
 * be deployed and executed).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateCollaboration, handleAddElement, handleValidate } from '../../../src/handlers';
import { handleSetEventDefinition } from '../../../src/handlers/properties/set-event-definition';
import { parseResult, createDiagram, clearDiagrams, connect, connectAll } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('bpmnlint multiple-expanded-pools', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('warns when multiple pools are expanded', async () => {
    const diagramId = await createDiagram();

    // Create a collaboration with two expanded pools (default)
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Main Process' }, { name: 'External System' }],
      })
    );

    expect(collab.participantIds).toHaveLength(2);

    // Validate — should warn about multiple expanded pools
    const res = parseResult(await handleValidate({ diagramId }));

    const issues =
      res.issues?.filter((issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools') ?? [];

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('expanded pools found');
    expect(issues[0].message).toContain('Main Process');
    expect(issues[0].message).toContain('External System');
  });

  test('does not warn when only one pool is expanded and the other is collapsed', async () => {
    const diagramId = await createDiagram();

    // Create a collaboration with one expanded pool and one collapsed pool
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Main Process' }, { name: 'Payment Gateway', collapsed: true }],
      })
    );

    expect(collab.participantIds).toHaveLength(2);

    // The collapsed pool should have a small height
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const collapsedPool = reg.get(collab.participantIds[1]);
    expect(collapsedPool.height).toBeLessThan(100); // collapsed height is ~60px

    // Validate — should NOT have the multiple-expanded-pools warning
    const res = parseResult(await handleValidate({ diagramId }));

    const issues =
      res.issues?.filter((issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools') ?? [];

    expect(issues.length).toBe(0);
  });

  test('warns about lanes conversion when multiple pools have isExecutable=true', async () => {
    // Use XML import to ensure processRef and isExecutable are properly set
    const { handleImportXml } = await import('../../../src/handlers');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Sales" name="Sales" processRef="Process_Sales" />
    <bpmn:participant id="P_Finance" name="Finance" processRef="Process_Finance" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Sales" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Order Received" />
  </bpmn:process>
  <bpmn:process id="Process_Finance" isExecutable="true">
    <bpmn:startEvent id="Start_2" name="Invoice Created" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Sales_di" bpmnElement="P_Sales" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="200" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_Finance_di" bpmnElement="P_Finance" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="200" y="400" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(await handleValidate({ diagramId }));
    const issues =
      res.issues?.filter((issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools') ?? [];

    expect(issues.length).toBeGreaterThan(0);
    // Should mention isExecutable and suggest lanes conversion
    expect(issues[0].message).toContain('isExecutable');
    expect(issues[0].message).toContain('lanes');
    expect(issues[0].message).toContain('"Sales"');
    expect(issues[0].message).toContain('"Finance"');
  });

  test('does not suggest lanes when only one pool is executable', async () => {
    // Use XML import — one pool executable, one not
    const { handleImportXml } = await import('../../../src/handlers');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P_Main" name="Main Process" processRef="Process_Main" />
    <bpmn:participant id="P_External" name="External System" processRef="Process_External" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Main" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
  </bpmn:process>
  <bpmn:process id="Process_External" isExecutable="false">
    <bpmn:startEvent id="Start_2" name="Ext Start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="P_Main_di" bpmnElement="P_Main" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="200" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P_External_di" bpmnElement="P_External" isHorizontal="true">
        <dc:Bounds x="0" y="300" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="200" y="400" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const importRes = parseResult(await handleImportXml({ xml }));
    const diagramId = importRes.diagramId;

    const res = parseResult(await handleValidate({ diagramId }));
    const issues =
      res.issues?.filter((issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools') ?? [];

    expect(issues.length).toBeGreaterThan(0);
    // Should use the general message (not the lanes-specific one)
    expect(issues[0].message).toContain('expanded pools found');
    expect(issues[0].message).not.toContain('isExecutable');
  });

  test('supports message flows to collapsed pools', async () => {
    const diagramId = await createDiagram();

    // Create collaboration: one expanded, one collapsed
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Order Process' }, { name: 'Payment Service', collapsed: true }],
      })
    );

    const mainPool = collab.participantIds[0];
    const collapsedPool = collab.participantIds[1];

    // Build a process in the main pool
    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Received',
        participantId: mainPool,
      })
    );
    const sendPayment = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:IntermediateThrowEvent',
        name: 'Request Payment',
        participantId: mainPool,
      })
    );
    await handleSetEventDefinition({
      diagramId,
      elementId: sendPayment.elementId,
      eventDefinitionType: 'bpmn:MessageEventDefinition',
      messageRef: { id: 'Msg_PayReq', name: 'PaymentRequest' },
    });
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: mainPool,
      })
    );
    await connectAll(diagramId, start.elementId, sendPayment.elementId, end.elementId);

    // Message flow from the main pool element to the collapsed pool participant
    await connect(diagramId, sendPayment.elementId, collapsedPool, {
      connectionType: 'bpmn:MessageFlow',
    });

    // Validate — should NOT have multiple-expanded-pools warning
    const res = parseResult(await handleValidate({ diagramId }));
    const poolIssues =
      res.issues?.filter((issue: any) => issue.rule === 'bpmn-mcp/multiple-expanded-pools') ?? [];
    expect(poolIssues.length).toBe(0);
  });
});
