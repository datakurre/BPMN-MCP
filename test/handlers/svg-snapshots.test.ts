/**
 * SVG snapshot generation for visual regression.
 *
 * Imports reference BPMN diagrams from test/fixtures/layout-references/,
 * runs ELK layout, and exports SVGs to `test/fixtures/layout-snapshots/`.
 * These serve as visual regression baselines — reviewers can open them
 * in a browser to see the actual layout engine output for the gold-standard
 * reference diagrams.
 *
 * Run with: npx vitest run test/handlers/svg-snapshots.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { handleLayoutDiagram, handleExportBpmn } from '../../src/handlers';
import { clearDiagrams, importReference } from '../helpers';

const SNAPSHOT_DIR = join(__dirname, '..', 'fixtures', 'layout-snapshots');

function ensureDir() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function exportSvg(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
  const text = res.content[0].text;
  return text;
}

function writeSvg(name: string, svg: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.svg`), svg);
}

// ── Reference BPMN names ───────────────────────────────────────────────────

const REFERENCES = [
  '01-linear-flow',
  '02-exclusive-gateway',
  '03-parallel-fork-join',
  '04-nested-subprocess',
  '05-collaboration',
  '06-boundary-events',
  '07-complex-workflow',
  '08-collaboration-collapsed',
];

// ── Test fixtures ──────────────────────────────────────────────────────────

describe('SVG snapshot generation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterAll(() => {
    clearDiagrams();
  });

  for (const refName of REFERENCES) {
    it(refName, async () => {
      const { diagramId } = await importReference(refName);
      await handleLayoutDiagram({ diagramId });
      const svg = await exportSvg(diagramId);
      expect(svg).toContain('<svg');
      writeSvg(refName, svg);
    });
  }
});
