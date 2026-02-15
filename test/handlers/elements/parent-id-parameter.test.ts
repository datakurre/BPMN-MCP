import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElement } from '../../../src/handlers/elements/add-element';
import { handleSetProperties } from '../../../src/handlers/properties/set-properties';
import { parseResult, createDiagram, clearDiagrams, exportXml } from '../../helpers';

describe('parentId parameter', () => {
  let diagramId: string;

  beforeEach(async () => {
    clearDiagrams();
    diagramId = await createDiagram('test-parent-id');
  });

  test('should nest start event inside event subprocess', async () => {
    // Create event subprocess
    const subProcessResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:SubProcess',
      name: 'Event Subprocess',
      x: 100,
      y: 100,
    });
    const subProcessId = parseResult(subProcessResult).elementId;

    // Mark as event subprocess
    await handleSetProperties({
      diagramId,
      elementId: subProcessId,
      properties: {
        triggeredByEvent: true,
      },
    });

    // Add start event INSIDE the event subprocess using parentId
    const startResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Timer',
      parentId: subProcessId,
      x: 150,
      y: 150,
    });
    const startId = parseResult(startResult).elementId;

    // Verify XML structure: start event should be nested inside subprocess
    const xml = await exportXml(diagramId);

    // Find the subprocess element in XML
    const subProcessStart = xml.indexOf(`<bpmn:subProcess id="${subProcessId}"`);
    const subProcessEnd = xml.indexOf('</bpmn:subProcess>', subProcessStart);
    const subProcessXml = xml.slice(subProcessStart, subProcessEnd);

    // Verify triggeredByEvent
    expect(xml).toContain('triggeredByEvent="true"');

    // Verify start event is nested inside subprocess
    expect(subProcessXml).toContain(`<bpmn:startEvent id="${startId}"`);
  });

  test('should throw error if parentId does not exist', async () => {
    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        parentId: 'NonExistentParent',
      })
    ).rejects.toThrow(/parent element not found/i);
  });
});
