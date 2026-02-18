/**
 * Unit tests for normalizePlaneElementOrder — the post-export DI plane
 * ordering pass that ensures BPMNShape elements appear before BPMNEdge
 * elements, matching Camunda Modeler's XML convention.
 */

import { describe, test, expect } from 'vitest';
import { normalizePlaneElementOrder } from '../../../src/handlers/core/export-helpers';

// Minimal BPMN XML template: process definition + BPMNPlane content
function makeXml(processDef: string, planeContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1">
  <bpmn:process id="Process_1">
${processDef}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
${planeContent}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

const PROCESS_DEF = `    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />`;

describe('normalizePlaneElementOrder', () => {
  test('passes collaboration diagrams through unchanged', () => {
    const xml = `<bpmn:definitions>
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Part_1" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmndi:BPMNDiagram>
    <bpmndi:BPMNPlane bpmnElement="Collab_1">
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1" />
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1" />
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    expect(normalizePlaneElementOrder(xml)).toBe(xml);
  });

  test('returns xml unchanged when already sorted shapes-first then edges', () => {
    const planeContent = `      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="192" y="114" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="288" y="92" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="228" y="132" />
        <di:waypoint x="288" y="132" />
      </bpmndi:BPMNEdge>`;
    const xml = makeXml(PROCESS_DEF, planeContent);
    // Already sorted: should be returned unchanged (idempotency)
    const result = normalizePlaneElementOrder(xml);
    expect(result).toBe(xml);
  });

  test('moves edges after shapes when edges precede some shapes', () => {
    // Edge appears before Task_1 shape — needs reordering
    const planeContent = `      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="192" y="114" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="228" y="132" />
        <di:waypoint x="288" y="132" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="288" y="92" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="388" y="132" />
        <di:waypoint x="448" y="132" />
      </bpmndi:BPMNEdge>`;
    const xml = makeXml(PROCESS_DEF, planeContent);
    const result = normalizePlaneElementOrder(xml);

    // All shapes should come before all edges in BPMNPlane
    const shapePos1 = result.indexOf('bpmnElement="Start_1"');
    const shapePos2 = result.indexOf('bpmnElement="Task_1"');
    const edgePos1 = result.indexOf('bpmnElement="Flow_1"');
    const edgePos2 = result.indexOf('bpmnElement="Flow_2"');

    expect(shapePos1).toBeLessThan(edgePos1);
    expect(shapePos1).toBeLessThan(edgePos2);
    expect(shapePos2).toBeLessThan(edgePos1);
    expect(shapePos2).toBeLessThan(edgePos2);
  });

  test('sorts shapes in process-definition order', () => {
    // Process def order: Start_1, Task_1, End_1
    // Plane has them in reverse: End_1, Task_1, Start_1
    const planeContent = `      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="600" y="114" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="288" y="92" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="192" y="114" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="228" y="132" />
        <di:waypoint x="288" y="132" />
      </bpmndi:BPMNEdge>`;
    const xml = makeXml(PROCESS_DEF, planeContent);
    const result = normalizePlaneElementOrder(xml);

    // Shapes should be in process-def order: Start_1, Task_1, End_1
    const startPos = result.indexOf('bpmnElement="Start_1"');
    const taskPos = result.indexOf('bpmnElement="Task_1"');
    const endPos = result.indexOf('bpmnElement="End_1"');
    const edgePos = result.indexOf('bpmnElement="Flow_1"');

    expect(startPos).toBeLessThan(taskPos);
    expect(taskPos).toBeLessThan(endPos);
    expect(endPos).toBeLessThan(edgePos);
  });

  test('normalises double blank line before closing BPMNPlane tag', () => {
    const planeContent = `      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="192" y="114" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="228" y="132" />
        <di:waypoint x="288" y="132" />
      </bpmndi:BPMNEdge>

    `;
    const xml = makeXml(PROCESS_DEF, planeContent);

    // The double \n before trailing "    " should be collapsed to single \n
    const result = normalizePlaneElementOrder(xml);
    const planeIdx = result.indexOf('<bpmndi:BPMNPlane');
    const planeEnd = result.indexOf('</bpmndi:BPMNPlane>');
    const planeSlice = result.slice(planeIdx, planeEnd + 20);

    // Should have exactly one newline before </bpmndi:BPMNPlane>
    expect(planeSlice).not.toMatch(/\n\n\s*<\/bpmndi:BPMNPlane>/);
    expect(planeSlice).toMatch(/\n\s*<\/bpmndi:BPMNPlane>/);
  });

  test('returns original xml on parse error', () => {
    // Malformed XML should not throw — returns original
    const malformed = 'not valid xml at all <<<<>';
    expect(normalizePlaneElementOrder(malformed)).toBe(malformed);
  });
});
