/**
 * Parameterised layout scenario test runner.
 *
 * Iterates over all scenarios defined in `builders.ts`, builds each
 * diagram programmatically, runs `layout_bpmn_diagram`, and checks:
 * 1. Every declared per-scenario layout expectation (position, lane, overlap…)
 * 2. Generic export invariants ported from reference-layout.test.ts (§10d):
 *    - XML export: valid BPMN with bpmndi:BPMNDiagram and DI for all shapes
 *    - SVG export: non-empty output
 *    - Round-trip XML import preserves element count
 *
 * See TODO.md §10c and §10d for the design rationale.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { clearDiagrams, getDiagram } from '../../src/diagram-manager';
import { handleLayoutDiagram, handleExportBpmn, handleImportXml } from '../../src/handlers';
import { parseResult } from '../helpers';
import { scenarios } from './builders';

describe('Layout scenarios', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      test('layout produces expected result', async () => {
        const { diagramId, expectations } = await scenario.build();

        await handleLayoutDiagram({ diagramId });

        const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;

        for (const expectation of expectations) {
          expectation.assert(registry);
        }
      });

      // ── §10d: Generic export invariants ───────────────────────────────

      test('XML export produces valid BPMN with DI', async () => {
        const { diagramId } = await scenario.build();
        await handleLayoutDiagram({ diagramId });

        const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
        const xml = res.content[0].text;

        expect(xml).toContain('<bpmn:definitions');
        expect(xml).toContain('</bpmn:definitions>');
        expect(xml).toContain('bpmndi:BPMNDiagram');
        expect(xml).toContain('bpmndi:BPMNPlane');

        // Every non-connection shape should have a bpmnElement reference
        const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
        const shapes = registry
          .getAll()
          .filter(
            (el: any) =>
              el.type !== 'bpmn:Process' &&
              el.type !== 'bpmn:Collaboration' &&
              el.type !== 'label' &&
              !el.type?.startsWith('bpmndi:') &&
              !el.type?.includes('SequenceFlow') &&
              !el.type?.includes('MessageFlow') &&
              !el.type?.includes('Association') &&
              !el.type?.includes('DataInputAssociation') &&
              !el.type?.includes('DataOutputAssociation') &&
              !el.type?.includes('LaneSet') &&
              el.width > 0
          );
        const missingDI: string[] = [];
        for (const shape of shapes) {
          const id = shape.businessObject?.id || shape.id;
          if (!xml.includes(`bpmnElement="${id}"`)) {
            missingDI.push(`${id} (${shape.type})`);
          }
        }
        expect(missingDI, `Missing DI for: ${missingDI.join(', ')}`).toHaveLength(0);
      });

      test('SVG export produces non-empty output', async () => {
        const { diagramId } = await scenario.build();
        await handleLayoutDiagram({ diagramId });

        const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
        const svg = res.content[0].text;
        expect(svg).toContain('<svg');
        expect(svg.length).toBeGreaterThan(100);
      });

      test('round-trip XML preserves element count', async () => {
        const { diagramId } = await scenario.build();
        await handleLayoutDiagram({ diagramId });

        const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
        const xml = res.content[0].text;

        const registry1 = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
        const count1 = registry1
          .getAll()
          .filter(
            (el: any) =>
              el.type !== 'bpmn:Process' &&
              el.type !== 'bpmn:Collaboration' &&
              el.type !== 'label' &&
              !el.type?.startsWith('bpmndi:')
          ).length;

        const result2 = parseResult(await handleImportXml({ xml }));
        expect(result2.success).toBe(true);

        const registry2 = getDiagram(result2.diagramId)!.modeler.get('elementRegistry') as any;
        const count2 = registry2
          .getAll()
          .filter(
            (el: any) =>
              el.type !== 'bpmn:Process' &&
              el.type !== 'bpmn:Collaboration' &&
              el.type !== 'label' &&
              !el.type?.startsWith('bpmndi:')
          ).length;

        expect(count2, `Element count mismatch: original=${count1}, re-imported=${count2}`).toBe(
          count1
        );
      });
    });
  }
});
