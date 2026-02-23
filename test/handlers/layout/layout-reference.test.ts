/**
 * Reference layout regression tests.
 *
 * Merged from layout-reference.test.ts and layout-references.test.ts.
 *
 * Imports reference BPMN diagrams from test/fixtures/layout-references/,
 * runs ELK layout, and validates:
 * - All connections are strictly orthogonal (no diagonals)
 * - No element overlaps
 * - Elements have valid positions
 * - XML export produces valid BPMN with DI
 * - SVG export produces non-empty output
 * - Round-trip XML preserves element count
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleImportXml, handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';
import { getDiagram, clearDiagrams } from '../../../src/diagram-manager';
import { parseResult, importReference } from '../../helpers';

// ── Discover reference files ───────────────────────────────────────────────

const REFERENCES_DIR = resolve(__dirname, '..', '..', 'fixtures', 'layout-references');
const referenceNames = readdirSync(REFERENCES_DIR)
  .filter((f) => f.endsWith('.bpmn'))
  .map((f) => f.replace('.bpmn', ''))
  .sort();

// ── Helpers ────────────────────────────────────────────────────────────────

function expectOrthogonal(conn: any) {
  const wps = conn.waypoints;
  if (!wps || wps.length < 2) return;
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    expect(
      dy < 1 || dx < 1,
      `Connection ${conn.id} segment ${i - 1}→${i} is diagonal: ` +
        `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
    ).toBe(true);
  }
}

function overlaps(a: any, b: any): boolean {
  const margin = 2;
  return (
    a.x < b.x + (b.width || 0) - margin &&
    a.x + (a.width || 0) > b.x + margin &&
    a.y < b.y + (b.height || 0) - margin &&
    a.y + (a.height || 0) > b.y + margin
  );
}

function countVisualElements(registry: any): number {
  return registry.filter(
    (el: any) =>
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      !el.type?.startsWith('bpmndi:')
  ).length;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Reference layout regression', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  for (const name of referenceNames) {
    describe(name, () => {
      test('all connections are orthogonal', async () => {
        const { diagramId, registry } = await importReference(name);
        await handleLayoutDiagram({ diagramId });

        const connections = registry.filter(
          (el: any) =>
            el.type === 'bpmn:SequenceFlow' ||
            el.type === 'bpmn:MessageFlow' ||
            el.type === 'bpmn:Association'
        );
        for (const conn of connections) {
          expectOrthogonal(conn);
        }
      });

      test('no element overlaps', async () => {
        const { diagramId, registry } = await importReference(name);
        await handleLayoutDiagram({ diagramId });

        const shapes = registry.filter(
          (el: any) =>
            !el.type?.includes('SequenceFlow') &&
            !el.type?.includes('MessageFlow') &&
            !el.type?.includes('Association') &&
            el.type !== 'bpmn:Process' &&
            el.type !== 'bpmn:Collaboration' &&
            el.type !== 'label' &&
            el.type !== 'bpmn:LaneSet' &&
            !el.type?.startsWith('bpmndi:') &&
            el.width !== undefined
        );

        const issues: string[] = [];
        for (let i = 0; i < shapes.length; i++) {
          for (let j = i + 1; j < shapes.length; j++) {
            const a = shapes[i];
            const b = shapes[j];
            if (
              a.parent?.id === b.id ||
              b.parent?.id === a.id ||
              a.type === 'bpmn:Participant' ||
              b.type === 'bpmn:Participant' ||
              a.type === 'bpmn:Lane' ||
              b.type === 'bpmn:Lane' ||
              a.type === 'bpmn:SubProcess' ||
              b.type === 'bpmn:SubProcess' ||
              a.type === 'bpmn:BoundaryEvent' ||
              b.type === 'bpmn:BoundaryEvent'
            ) {
              continue;
            }
            if (overlaps(a, b)) {
              issues.push(`${a.id} overlaps ${b.id}`);
            }
          }
        }
        expect(issues, `Found ${issues.length} overlaps`).toHaveLength(0);
      });

      test('elements have valid positions', async () => {
        const { diagramId, registry } = await importReference(name);
        await handleLayoutDiagram({ diagramId });

        const shapes = registry.filter(
          (el: any) =>
            (el.type?.includes('Task') ||
              el.type?.includes('Event') ||
              el.type?.includes('Gateway')) &&
            el.type !== 'bpmn:BoundaryEvent'
        );
        for (const el of shapes) {
          expect(typeof el.x).toBe('number');
          expect(typeof el.y).toBe('number');
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.y).toBeGreaterThanOrEqual(0);
        }
      });

      test('XML export produces valid BPMN with DI', async () => {
        const { diagramId } = await importReference(name);
        await handleLayoutDiagram({ diagramId });
        const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
        const xml = res.content[0].text;
        expect(xml).toContain('<bpmn:definitions');
        expect(xml).toContain('</bpmn:definitions>');
        expect(xml).toContain('bpmndi:BPMNDiagram');
        expect(xml).toContain('bpmndi:BPMNPlane');

        // Verify DI present for all visible shapes
        const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
        const shapes = registry.filter(
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
        expect(missingDI.length, `Missing DI: ${missingDI.join(', ')}`).toBe(0);
      });

      test('SVG export produces non-empty output', async () => {
        const { diagramId } = await importReference(name);
        await handleLayoutDiagram({ diagramId });
        const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
        const svg = res.content[0].text;
        expect(svg).toContain('<svg');
        expect(svg.length).toBeGreaterThan(100);
      });

      test('round-trip XML preserves element count', async () => {
        const { diagramId } = await importReference(name);
        await handleLayoutDiagram({ diagramId });

        const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
        const xml = res.content[0].text;

        const registry1 = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;
        const count1 = countVisualElements(registry1);

        const result2 = parseResult(await handleImportXml({ xml }));
        expect(result2.success).toBe(true);

        const registry2 = getDiagram(result2.diagramId)!.modeler.get('elementRegistry') as any;
        const count2 = countVisualElements(registry2);
        expect(count2, `Element count mismatch: original=${count1}, re-imported=${count2}`).toBe(
          count1
        );
      });
    });
  }
});
