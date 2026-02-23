/**
 * Story 9: Incremental Editing — import, modify, verify stability
 *
 * Verifies that importing an existing BPMN diagram and adding elements
 * incrementally does not unnecessarily displace existing elements, and
 * new elements are placed in bpmn-js style relative to their anchor.
 *
 * Covers: import_bpmn_xml, add_bpmn_element (afterElementId, flowId),
 * connect_bpmn_elements, layout_bpmn_diagram
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleImportXml,
  handleAddElement,
  handleListElements,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';
import { getDiagram } from '../../src/diagram-manager';
import { resolve } from 'node:path';

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

describe('Story 9: Incremental Editing — import and modify', () => {
  const s = {
    diagramId: '',
    originalPositions: new Map<string, { x: number; y: number }>(),
    newTaskId: '',
    newEndId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S9-Step01: Import an existing linear-flow diagram', async () => {
    const filePath = resolve(REFERENCES_DIR, '01-linear-flow.bpmn');
    const res = parseResult(await handleImportXml({ filePath }));
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    // Capture original positions
    const state = getDiagram(s.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;
    registry.getAll().forEach((el: any) => {
      if (el.type && !el.type.includes('label') && el.x !== undefined) {
        s.originalPositions.set(el.id, { x: el.x, y: el.y });
      }
    });
    expect(s.originalPositions.size).toBeGreaterThan(0);
  });

  test('S9-Step02: Add a new task after an existing element', async () => {
    // Find an existing task to append after
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const tasks = listRes.elements.filter((e: any) => e.type?.includes('Task'));
    expect(tasks.length).toBeGreaterThan(0);

    const lastTask = tasks[tasks.length - 1];
    const taskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'New Review Step',
        afterElementId: lastTask.id,
      })
    );
    expect(taskRes.success).toBe(true);
    s.newTaskId = taskRes.elementId;

    // New element should be to the right of the anchor
    const state = getDiagram(s.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;
    const anchor = registry.get(lastTask.id);
    const newEl = registry.get(s.newTaskId);
    expect(newEl.x).toBeGreaterThan(anchor.x);
  });

  test('S9-Step03: Verify existing elements are not displaced', async () => {
    const state = getDiagram(s.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;

    let displacedCount = 0;
    for (const [id, origPos] of s.originalPositions) {
      const el = registry.get(id);
      if (!el) continue; // Element may have been removed
      const dx = Math.abs(el.x - origPos.x);
      const dy = Math.abs(el.y - origPos.y);
      // Allow small displacement for shift-right behaviour
      if (dx > 200 || dy > 200) {
        displacedCount++;
      }
    }
    // At most a few elements may shift due to auto-connection behaviour
    expect(
      displacedCount,
      `${displacedCount} elements were significantly displaced after adding one task`
    ).toBeLessThanOrEqual(3);
  });

  test('S9-Step04: Export and verify integrity', async () => {
    const xmlRes = await handleExportBpmn({
      diagramId: s.diagramId,
      format: 'both',
      skipLint: true,
    });
    const xml = xmlRes.content[0].text;
    const svg = xmlRes.content[1]?.text ?? '';

    expect(xml).toContain('New Review Step');
    expect(xml).toContain('BPMNShape');
    expect(svg).toContain('<svg');

    await assertStep(s.diagramId, 'S9-Step04', {
      containsElements: ['New Review Step'],
      snapshotFile: 'story-09/step-04.bpmn',
    });
  });
});
