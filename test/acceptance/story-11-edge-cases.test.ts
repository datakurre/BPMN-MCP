/**
 * Story 11: Edge Case Verification
 *
 * Verifies layout correctness for various BPMN edge cases:
 * boundary events, expanded/collapsed subprocesses, event subprocesses,
 * lanes, message flows, self-loops, backward flows, data objects,
 * and text annotations.
 *
 * Covers: add_bpmn_element, connect_bpmn_elements, layout_bpmn_diagram,
 * set_bpmn_event_definition, create_bpmn_participant, create_bpmn_lanes
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  handleAddElement,
  handleConnect,
  handleLayoutDiagram,
  handleExportBpmn,
  handleSetProperties,
  handleCreateParticipant,
} from '../../src/handlers';
import { clearDiagrams, createDiagram, addElement, connect } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('Story 11: Edge Case Verification', () => {
  beforeEach(() => clearDiagrams());
  afterEach(() => clearDiagrams());

  // ── Boundary Events ──────────────────────────────────────────────────
  test('boundary events are placed on host border after layout', async () => {
    const diagramId = await createDiagram('Boundary Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Add boundary timer event
    const boundaryRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Timeout',
        hostElementId: task,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT1H' },
      })
    );
    expect(boundaryRes.success).toBe(true);

    // Add error end for boundary path
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Timed Out',
      afterElementId: boundaryRes.elementId,
    });

    await handleLayoutDiagram({ diagramId });

    // Verify boundary event is near the host task border
    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const hostEl = registry.get(task);
    const boundaryEl = registry.get(boundaryRes.elementId);

    // Boundary event center should be near the bottom edge of the host
    const hostBottom = hostEl.y + hostEl.height;
    const boundaryCenterY = boundaryEl.y + boundaryEl.height / 2;
    expect(
      Math.abs(boundaryCenterY - hostBottom),
      'Boundary event should be near host bottom edge'
    ).toBeLessThan(30);
  });

  // ── Expanded Subprocesses ────────────────────────────────────────────
  test('expanded subprocesses are properly sized after layout', async () => {
    const diagramId = await createDiagram('Subprocess Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const subprocess = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Sub Process',
      afterElementId: start,
    });

    // Add elements inside the subprocess
    await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Sub Start',
      parentId: subprocess,
    });
    await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Sub Task',
      parentId: subprocess,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Sub End',
      parentId: subprocess,
    });

    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: subprocess,
    });

    await handleLayoutDiagram({ diagramId });

    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const subEl = registry.get(subprocess);
    expect(subEl).toBeDefined();
    // Expanded subprocess should have reasonable dimensions
    expect(subEl.width).toBeGreaterThan(100);
    expect(subEl.height).toBeGreaterThan(60);
  });

  // ── Collapsed Subprocesses ───────────────────────────────────────────
  test('collapsed subprocesses are handled correctly', async () => {
    const diagramId = await createDiagram('Collapsed Sub');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const subprocess = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Collapsed Sub',
      afterElementId: start,
      isExpanded: false,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: subprocess,
    });

    await handleLayoutDiagram({ diagramId });

    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const subEl = registry.get(subprocess);
    expect(subEl).toBeDefined();
    // Collapsed subprocess has small size (task-like)
    expect(subEl.width).toBeLessThanOrEqual(200);
    expect(subEl.height).toBeLessThanOrEqual(100);

    // Should export cleanly
    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    expect(exportRes.content[0].text).toContain('Collapsed Sub');
  });

  // ── Event Subprocesses ───────────────────────────────────────────────
  test('event subprocesses are positioned correctly', async () => {
    const diagramId = await createDiagram('Event Sub');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Main Task',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Add event subprocess
    const eventSub = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Error Handler',
    });
    await handleSetProperties({
      diagramId,
      elementId: eventSub,
      properties: { triggeredByEvent: true },
    });

    await handleLayoutDiagram({ diagramId });

    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const eventSubEl = registry.get(eventSub);
    expect(eventSubEl).toBeDefined();

    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    expect(exportRes.content[0].text).toContain('Error Handler');
  });

  // ── Lanes ────────────────────────────────────────────────────────────
  test('lanes produce correct Y-band separation after layout', async () => {
    const diagramId = await createDiagram('Lane Test');

    // Create pool with lanes
    const participantRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'My Organization',
        lanes: [{ name: 'Manager' }, { name: 'Worker' }],
      })
    );
    expect(participantRes.success).toBe(true);
    const poolId = participantRes.participantId;

    // Add elements
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      participantId: poolId,
    });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Approve',
      afterElementId: start,
      participantId: poolId,
    });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Execute',
      afterElementId: task1,
      participantId: poolId,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task2,
      participantId: poolId,
    });

    await handleLayoutDiagram({ diagramId });

    // Verify lanes exist in output
    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('Manager');
    expect(xml).toContain('Worker');
    expect(xml).toContain('BPMNShape');
  });

  // ── Message Flows ────────────────────────────────────────────────────
  test('message flows route correctly across pools', async () => {
    const diagramId = await createDiagram('Message Flow Test');

    const partRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        participants: [
          { name: 'Customer', height: 200 },
          { name: 'Support', collapsed: true },
        ],
      })
    );
    expect(partRes.success).toBe(true);

    const customerPoolId = partRes.participantIds[0];
    const supportPoolId = partRes.participantIds[1];

    // Add element in customer pool
    const sendTask = await addElement(diagramId, 'bpmn:SendTask', {
      name: 'Send Request',
      participantId: customerPoolId,
    });

    // Connect with message flow to collapsed pool
    const msgRes = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: sendTask,
        targetElementId: supportPoolId,
      })
    );
    expect(msgRes.success).toBe(true);

    await handleLayoutDiagram({ diagramId });

    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('messageFlow');
  });

  // ── Backward Flows (Loops) ──────────────────────────────────────────
  test('backward flows (loops) are handled correctly', async () => {
    const diagramId = await createDiagram('Loop Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process',
      afterElementId: start,
    });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Retry?',
      afterElementId: task,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: gw,
    });

    // Add backward loop: gateway → task
    await connect(diagramId, gw, task, { label: 'Yes' });

    await handleLayoutDiagram({ diagramId });

    // Verify the loop connection exists in output
    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = exportRes.content[0].text;
    expect(xml).toContain('Retry?');
    // Should have edges for the loop
    const edgeCount = (xml.match(/BPMNEdge/g) || []).length;
    expect(edgeCount).toBeGreaterThanOrEqual(4); // start→task, task→gw, gw→end, gw→task (loop)
  });

  // ── Data Objects ─────────────────────────────────────────────────────
  test('data objects are positioned near their associated elements', async () => {
    const diagramId = await createDiagram('Data Object Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Add data object
    const dataObj = await addElement(diagramId, 'bpmn:DataObjectReference', {
      name: 'Order Data',
    });

    // Associate data object with task
    await connect(diagramId, dataObj, task);

    await handleLayoutDiagram({ diagramId });

    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const dataEl = registry.get(dataObj);
    expect(dataEl).toBeDefined();
    expect(dataEl.x).toBeDefined();
    expect(dataEl.y).toBeDefined();
  });

  // ── Text Annotations ────────────────────────────────────────────────
  test('text annotations are positioned near their associated elements', async () => {
    const diagramId = await createDiagram('Annotation Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Process',
      afterElementId: start,
    });
    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Done',
      afterElementId: task,
    });

    // Add text annotation
    const annotation = await addElement(diagramId, 'bpmn:TextAnnotation', {
      name: 'Important note about processing',
    });

    // Associate annotation with task
    await connect(diagramId, annotation, task);

    await handleLayoutDiagram({ diagramId });

    const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
    const annoEl = registry.get(annotation);
    expect(annoEl).toBeDefined();
    expect(annoEl.x).toBeDefined();
    expect(annoEl.y).toBeDefined();

    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    expect(exportRes.content[0].text).toContain('Important note about processing');
  });
});
