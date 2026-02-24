/**
 * Rebuild engine coverage: runs the rebuild engine on ALL layout-reference
 * fixtures to verify it doesn't crash and produces valid positions.
 *
 * This is the automated part of Phase 5.7 — full visual comparison
 * requires human review of the SVG output.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildLayout } from '../../src/rebuild';
import { importReference, clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import type { ElementRegistry } from '../../src/bpmn-types';

afterEach(() => clearDiagrams());

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');
const referenceNames = readdirSync(REFERENCES_DIR)
  .filter((f) => f.endsWith('.bpmn'))
  .map((f) => f.replace('.bpmn', ''))
  .sort();

function getRegistry(diagramId: string): ElementRegistry {
  return getDiagram(diagramId)!.modeler.get('elementRegistry') as ElementRegistry;
}

describe('rebuild engine — all layout references', () => {
  for (const name of referenceNames) {
    describe(name, () => {
      test('rebuild completes without errors', async () => {
        const { diagramId } = await importReference(name);
        const diagram = getDiagram(diagramId)!;

        const result = rebuildLayout(diagram);

        expect(result.repositionedCount).toBeGreaterThanOrEqual(0);
        expect(result.reroutedCount).toBeGreaterThanOrEqual(0);
      });

      test('all flow nodes have valid positions after rebuild', async () => {
        const { diagramId } = await importReference(name);
        const diagram = getDiagram(diagramId)!;

        rebuildLayout(diagram);

        const registry = getRegistry(diagramId);
        const all = registry.getAll() as any[];
        const flowNodes = all.filter(
          (el) =>
            el.type !== 'bpmn:Process' &&
            el.type !== 'bpmn:Collaboration' &&
            el.type !== 'label' &&
            el.type !== 'bpmn:SequenceFlow' &&
            el.type !== 'bpmn:MessageFlow' &&
            el.type !== 'bpmn:Association' &&
            el.type !== 'bpmn:DataInputAssociation' &&
            el.type !== 'bpmn:DataOutputAssociation' &&
            el.type !== 'bpmn:Lane' &&
            el.type !== 'bpmn:LaneSet' &&
            !el.type?.startsWith('bpmndi:')
        );

        for (const el of flowNodes) {
          expect(el.width, `${el.id} should have width`).toBeGreaterThan(0);
          expect(el.height, `${el.id} should have height`).toBeGreaterThan(0);
        }
      });

      test('sequence flows have waypoints after rebuild', async () => {
        const { diagramId } = await importReference(name);
        const diagram = getDiagram(diagramId)!;

        rebuildLayout(diagram);

        const registry = getRegistry(diagramId);
        const all = registry.getAll() as any[];
        const flows = all.filter((el) => el.type === 'bpmn:SequenceFlow');

        for (const flow of flows) {
          expect(flow.waypoints, `${flow.id} should have waypoints`).toBeDefined();
          expect(
            flow.waypoints.length,
            `${flow.id} should have ≥2 waypoints`
          ).toBeGreaterThanOrEqual(2);
        }
      });
    });
  }
});
