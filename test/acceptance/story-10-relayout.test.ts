/**
 * Story 10: Full Re-layout of Imported Diagrams
 *
 * Tests import_bpmn_xml with autoLayout on diagrams without DI coordinates,
 * and verifies the simplified ELK pipeline produces acceptable layouts on
 * all reference diagrams.
 *
 * Covers: import_bpmn_xml (autoLayout), layout_bpmn_diagram, export_bpmn
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleImportXml, handleLayoutDiagram, handleExportBpmn } from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { parseResult } from './helpers';
import { getDiagram } from '../../src/diagram-manager';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

const REFERENCES = [
  '01-linear-flow',
  '02-exclusive-gateway',
  '03-parallel-fork-join',
  '04-nested-subprocess',
  '05-collaboration',
  '06-boundary-events',
  '07-complex-workflow',
  '08-collaboration-collapsed',
  '09-complex-workflow',
  '10-pool-with-lanes',
];

/**
 * Strip all DI (diagram interchange) coordinates from BPMN XML.
 * This forces auto-layout on import.
 */
function stripDiCoordinates(xml: string): string {
  // Remove the entire bpmndi:BPMNDiagram element
  return xml.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, '');
}

describe('Story 10: Full Re-layout of Imported Diagrams', () => {
  beforeEach(() => clearDiagrams());
  afterEach(() => clearDiagrams());

  test('S10-Step01: Import BPMN without DI triggers auto-layout', async () => {
    // Use a simple process XML without DI
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Do Work">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="End">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

    const res = parseResult(await handleImportXml({ xml }));
    expect(res.success).toBe(true);

    // Verify elements have positions (auto-layout was triggered)
    const state = getDiagram(res.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;
    const start = registry.get('Start_1');
    expect(start).toBeDefined();
    expect(start.x).toBeDefined();
    expect(start.y).toBeDefined();

    // Elements should be in a reasonable left-to-right order
    const task = registry.get('Task_1');
    const end = registry.get('End_1');
    expect(task.x).toBeGreaterThan(start.x);
    expect(end.x).toBeGreaterThan(task.x);
  });

  for (const refName of REFERENCES) {
    test(`S10-Layout: ${refName} — re-layout produces clean output`, async () => {
      const filePath = resolve(REFERENCES_DIR, `${refName}.bpmn`);
      const res = parseResult(await handleImportXml({ filePath }));
      expect(res.success).toBe(true);

      await handleLayoutDiagram({ diagramId: res.diagramId });

      // Verify export works
      const exportRes = await handleExportBpmn({
        diagramId: res.diagramId,
        format: 'xml',
        skipLint: true,
      });
      const xml = exportRes.content[0].text;
      expect(xml).toContain('<bpmn:definitions');
      expect(xml).toContain('BPMNShape');

      // Verify elements have valid positions
      const state = getDiagram(res.diagramId)!;
      const registry = state.modeler.get('elementRegistry') as any;
      const shapeElements = registry
        .getAll()
        .filter(
          (el: any) =>
            el.type &&
            !el.type.includes('label') &&
            !el.type.includes('Process') &&
            !el.type.includes('Collaboration') &&
            !el.type.includes('Lane') &&
            !el.type.includes('Participant') &&
            !el.type.includes('SequenceFlow') &&
            !el.type.includes('MessageFlow') &&
            !el.type.includes('Association') &&
            !el.type.includes('DataInputAssociation') &&
            !el.type.includes('DataOutputAssociation') &&
            !el.type.includes('LaneSet') &&
            el.width > 0
        );

      // Basic sanity: all shape elements should have defined coordinates
      for (const el of shapeElements) {
        expect(el.x, `${el.id} (${el.type}) should have defined x`).toBeDefined();
        expect(el.y, `${el.id} (${el.type}) should have defined y`).toBeDefined();
      }
    });
  }

  test('S10-Step02: Stripped DI re-layout matches structure', async () => {
    // Import a reference with DI stripped → forces auto-layout
    const filePath = resolve(REFERENCES_DIR, '02-exclusive-gateway.bpmn');
    const originalXml = readFileSync(filePath, 'utf-8');
    const strippedXml = stripDiCoordinates(originalXml);

    // Verify DI was actually stripped
    expect(strippedXml).not.toContain('BPMNDiagram');

    const res = parseResult(await handleImportXml({ xml: strippedXml }));
    expect(res.success).toBe(true);

    // Verify auto-layout was applied (elements have positions)
    const state = getDiagram(res.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;
    const elements = registry
      .getAll()
      .filter((el: any) => el.type?.includes('Task') || el.type?.includes('Gateway'));
    expect(elements.length).toBeGreaterThan(0);

    for (const el of elements) {
      expect(el.x, `${el.id} should be positioned`).toBeDefined();
    }

    // Should be exportable
    const exportRes = await handleExportBpmn({
      diagramId: res.diagramId,
      format: 'xml',
      skipLint: true,
    });
    expect(exportRes.content[0].text).toContain('BPMNShape');
  });
});
