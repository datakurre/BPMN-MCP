/**
 * Reference diagram snapshot generation and SVG position comparison.
 *
 * Part 1 — Snapshot generation:
 *   Imports reference BPMN diagrams, runs layout, and exports SVGs/BPMNs
 *   to `test/fixtures/layout-snapshots/` for visual regression review.
 *
 * Part 2 — SVG comparison:
 *   Compares element positions in generated SVGs against reference SVGs,
 *   normalising away uniform origin offset and reporting remaining deltas.
 *
 * Merged from svg-snapshots.test.ts and svg-comparison.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';
import {
  clearDiagrams,
  importReference,
  loadPositionsFromSVG,
  parsePositionsFromSVG,
  compareWithNormalisation,
} from '../../helpers';

// ── Paths ──────────────────────────────────────────────────────────────────

const SNAPSHOT_DIR = join(__dirname, '../..', 'fixtures', 'layout-snapshots');
const REFERENCE_DIR = join(__dirname, '../..', 'fixtures', 'layout-references');

// ── Export helpers ──────────────────────────────────────────────────────────

function ensureDir() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function exportSvgString(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
  return res.content[0].text;
}

async function exportXmlString(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
  return res.content[0].text;
}

/**
 * Normalise random marker IDs in SVG output to deterministic sequential
 * names (marker-seq-0, marker-seq-1, …). Preserves the id↔url(#id)
 * relationship so the SVG remains viewable, while eliminating
 * non-deterministic diffs. The pattern requires 8+ alphanumeric chars
 * after `marker-` to avoid matching CSS properties like `marker-end`.
 */
function normaliseMarkerIds(svg: string): string {
  const seen = new Map<string, string>();
  let counter = 0;
  return svg.replace(/marker-[a-z0-9]{8,}/g, (match) => {
    if (!seen.has(match)) {
      seen.set(match, `marker-seq-${counter++}`);
    }
    return seen.get(match)!;
  });
}

function writeSvg(name: string, svg: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.svg`), normaliseMarkerIds(svg));
}

function writeBpmn(name: string, xml: string) {
  ensureDir();
  writeFileSync(join(SNAPSHOT_DIR, `${name}.bpmn`), xml);
}

// ── Comparison helpers ─────────────────────────────────────────────────────

function logNormalisedMismatches(
  name: string,
  result: ReturnType<typeof compareWithNormalisation>
) {
  const { originOffset, deltas, mismatches, matchRate } = result;
  console.error(`\n── SVG comparison: ${name} ──`);
  console.error(
    `  Origin offset: Δx=${originOffset.dx.toFixed(0)}, Δy=${originOffset.dy.toFixed(0)}`
  );
  console.error(
    `  Match rate: ${(matchRate * 100).toFixed(1)}% (${deltas.length - mismatches.length}/${deltas.length})`
  );
  if (mismatches.length > 0) {
    console.error(`  Mismatches (${mismatches.length}):`);
    for (const m of mismatches) {
      console.error(
        `    ${m.elementId}: ref(${m.refX},${m.refY}) gen(${m.genX},${m.genY}) normalised Δ(${m.dx.toFixed(0)},${m.dy.toFixed(0)})`
      );
    }
  }
}

// ── Reference diagram names ────────────────────────────────────────────────

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
  '11-event-subprocess',
  '12-text-annotation',
];

interface DiagramConfig {
  name: string;
  tolerance: number;
  /** Minimum acceptable match rate (0-1). 0 = tracking only, 1 = exact. */
  minMatchRate: number;
}

const DIAGRAM_CONFIGS: DiagramConfig[] = [
  { name: '01-linear-flow', tolerance: 10, minMatchRate: 0.5 },
  { name: '02-exclusive-gateway', tolerance: 25, minMatchRate: 0.35 },
  { name: '03-parallel-fork-join', tolerance: 25, minMatchRate: 0.5 },
  { name: '04-nested-subprocess', tolerance: 10, minMatchRate: 0.25 },
  { name: '05-collaboration', tolerance: 25, minMatchRate: 0.4 },
  { name: '06-boundary-events', tolerance: 50, minMatchRate: 0.6 },
  { name: '07-complex-workflow', tolerance: 50, minMatchRate: 0.35 },
  { name: '08-collaboration-collapsed', tolerance: 25, minMatchRate: 0.6 },
  { name: '09-complex-workflow', tolerance: 50, minMatchRate: 0.5 },
  { name: '10-pool-with-lanes', tolerance: 25, minMatchRate: 0.6 },
  { name: '11-event-subprocess', tolerance: 25, minMatchRate: 0.5 },
  { name: '12-text-annotation', tolerance: 25, minMatchRate: 0.4 },
];

// ── Part 1: Snapshot generation ────────────────────────────────────────────

describe('SVG snapshot generation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  for (const refName of REFERENCES) {
    test(refName, async () => {
      const { diagramId } = await importReference(refName);
      await handleLayoutDiagram({ diagramId });
      const svg = await exportSvgString(diagramId);
      const xml = await exportXmlString(diagramId);
      expect(svg).toContain('<svg');
      expect(xml).toContain('<bpmn:definitions');
      writeSvg(refName, svg);
      writeBpmn(refName, xml);
    });
  }
});

// ── Part 2: SVG position comparison ────────────────────────────────────────

describe('SVG position comparison (normalised)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  for (const config of DIAGRAM_CONFIGS) {
    describe(config.name, () => {
      test('reference SVG has parseable positions', () => {
        const refPath = join(REFERENCE_DIR, `${config.name}.svg`);
        const refPositions = loadPositionsFromSVG(refPath);
        expect(refPositions.size).toBeGreaterThan(0);
      });

      test(`normalised positions within ${config.tolerance}px tolerance`, async () => {
        const { diagramId } = await importReference(config.name);
        await handleLayoutDiagram({ diagramId });
        const genSvg = await exportSvgString(diagramId);

        const refPath = join(REFERENCE_DIR, `${config.name}.svg`);
        const refPositions = loadPositionsFromSVG(refPath);
        const genPositions = parsePositionsFromSVG(genSvg);

        expect(refPositions.size).toBeGreaterThan(0);
        expect(genPositions.size).toBeGreaterThan(0);

        const result = compareWithNormalisation(refPositions, genPositions, config.tolerance);
        logNormalisedMismatches(config.name, result);

        expect(
          result.matchRate,
          `Match rate ${(result.matchRate * 100).toFixed(1)}% below minimum ${(config.minMatchRate * 100).toFixed(1)}%`
        ).toBeGreaterThanOrEqual(config.minMatchRate);
      });
    });
  }
});
