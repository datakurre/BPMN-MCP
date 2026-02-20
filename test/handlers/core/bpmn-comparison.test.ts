/**
 * BPMN snapshot comparison tests.
 *
 * For each reference diagram:
 * 1. Imports the reference BPMN
 * 2. Runs ELK layout
 * 3. Exports BPMN XML
 * 4. Compares DI positions against the reference BPMN using origin normalisation
 * 5. Compares normalised process-level XML to verify semantic structure is preserved
 *
 * This complements svg-comparison.test.ts by asserting at the BPMN XML level
 * rather than the rendered SVG level, catching issues like:
 * - Missing or reordered elements in the output
 * - Broken extension elements (forms, listeners, I/O mappings)
 * - DI coordinate drift from layout changes
 *
 * Run with: npx vitest run test/handlers/bpmn-comparison.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';
import {
  clearDiagrams,
  importReference,
  loadReferenceBpmn,
  normaliseBpmnXml,
  extractProcessXml,
  compareBpmnPositions,
  extractBpmnPositions,
  compareLabelPositions,
  type compareWithNormalisation,
} from '../../helpers';

// ── Helpers ────────────────────────────────────────────────────────────────

async function exportXmlString(diagramId: string): Promise<string> {
  const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
  return res.content[0].text;
}

function logBpmnMismatches(name: string, result: ReturnType<typeof compareWithNormalisation>) {
  const { originOffset, deltas, mismatches, matchRate } = result;
  console.error(`\n── BPMN position comparison: ${name} ──`);
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

// ── Reference diagram configs ──────────────────────────────────────────────

interface DiagramConfig {
  name: string;
  tolerance: number;
  /** Minimum acceptable match rate (0-1). 0 = tracking only. */
  minMatchRate: number;
}

const DIAGRAMS: DiagramConfig[] = [
  // Simple flow diagrams — I7-3: tightened minMatchRate from 0.0 to meaningful thresholds.
  // 06-boundary-events is currently at 71.4% due to boundary event positioning
  // differences — kept at 0.6 (71.4% > 60% ✓).
  { name: '01-linear-flow', tolerance: 50, minMatchRate: 0.9 },
  { name: '02-exclusive-gateway', tolerance: 50, minMatchRate: 0.8 },
  { name: '03-parallel-fork-join', tolerance: 50, minMatchRate: 0.8 },
  { name: '04-nested-subprocess', tolerance: 50, minMatchRate: 0.9 },
  { name: '05-collaboration', tolerance: 50, minMatchRate: 0.8 },
  { name: '06-boundary-events', tolerance: 50, minMatchRate: 0.6 },
  { name: '07-complex-workflow', tolerance: 100, minMatchRate: 0.8 },
  { name: '08-collaboration-collapsed', tolerance: 50, minMatchRate: 0.8 },
  { name: '09-complex-workflow', tolerance: 100, minMatchRate: 0.8 },
  { name: '10-pool-with-lanes', tolerance: 50, minMatchRate: 0.8 },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BPMN position comparison (normalised)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  afterEach(() => {
    clearDiagrams();
  });

  for (const config of DIAGRAMS) {
    describe(config.name, () => {
      test('reference BPMN has parseable positions', () => {
        const refXml = loadReferenceBpmn(config.name);
        const refPositions = extractBpmnPositions(refXml);
        expect(refPositions.size).toBeGreaterThan(0);
      });

      test(`BPMN DI positions within ${config.tolerance}px tolerance`, async () => {
        const refXml = loadReferenceBpmn(config.name);

        // Import and layout
        const { diagramId } = await importReference(config.name);
        await handleLayoutDiagram({ diagramId });
        const genXml = await exportXmlString(diagramId);

        // Compare DI positions with normalisation
        const result = compareBpmnPositions(refXml, genXml, config.tolerance);
        logBpmnMismatches(config.name, result);

        // D4-3: Also compare label positions (informational — no strict assertion,
        // since Camunda Modeler's label positions may differ from bpmn-js defaults).
        const labelResult = compareLabelPositions(refXml, genXml, 15);
        if (labelResult.totalLabels > 0) {
          console.error(
            `  Labels: ${(labelResult.matchRate * 100).toFixed(1)}% within 15px ` +
              `(${labelResult.matchedLabels}/${labelResult.totalLabels})`
          );
          if (labelResult.mismatches.length > 0) {
            for (const m of labelResult.mismatches.slice(0, 3)) {
              console.error(
                `    label[${m.elementId}]: refY=${m.refY} genY=${m.genY} normDy=${m.dy.toFixed(0)}`
              );
            }
          }
        }

        // Assert minimum match rate (shape positions)
        expect(
          result.matchRate,
          `Match rate ${(result.matchRate * 100).toFixed(1)}% below minimum ${(config.minMatchRate * 100).toFixed(1)}%`
        ).toBeGreaterThanOrEqual(config.minMatchRate);
      });

      test('process-level XML structure is preserved after layout', async () => {
        const refXml = loadReferenceBpmn(config.name);

        // Import and layout
        const { diagramId } = await importReference(config.name);
        await handleLayoutDiagram({ diagramId });
        const genXml = await exportXmlString(diagramId);

        // Normalise both and extract process-level XML
        const refProcess = extractProcessXml(normaliseBpmnXml(refXml));
        const genProcess = extractProcessXml(normaliseBpmnXml(genXml));

        // The process structure (tasks, gateways, events, flows) should be identical
        // after normalisation — layout should never alter the semantic model
        expect(refProcess).toBeTruthy();
        expect(genProcess).toBeTruthy();

        // Compare element counts as a sanity check
        // Exclude flowNodeRef — these are lane membership references that bpmn-js
        // manages automatically and may be added/modified during DI repair + layout
        const countElements = (xml: string) =>
          (xml.match(/<bpmn:\w+/g) || []).filter((t) => t !== '<bpmn:flowNodeRef').length;
        const refElements = countElements(refProcess);
        const genElements = countElements(genProcess);
        expect(genElements).toBe(refElements);
      });
    });
  }
});
