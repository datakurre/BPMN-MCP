/**
 * Benchmark: ELK node-placement strategies on reference.bpmn.
 *
 * Compares NETWORK_SIMPLEX, BRANDES_KOEPF, and LINEAR_SEGMENTS to
 * determine which produces the best layout for BPMN diagrams.
 *
 * Metrics per strategy:
 * - Y-variance of main-path elements (lower = better straight-line alignment)
 * - Total diagram width and height
 * - Whether parallel branches (Task_Ship, Task_Invoice) are on distinct Y rows
 * - Whether all main-path flows are orthogonal
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleLayoutDiagram, handleImportXml } from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { getDiagram } from '../../src/diagram-manager';
import { ELK_LAYOUT_OPTIONS } from '../../src/elk/constants';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

type Strategy = 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF' | 'LINEAR_SEGMENTS';

interface StrategyMetrics {
  strategy: Strategy;
  yVariance: number;
  diagramWidth: number;
  diagramHeight: number;
  parallelBranchesDistinct: boolean;
  allMainPathOrthogonal: boolean;
  leftToRightValid: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/reference.bpmn');

/** Centre-X of an element. */
function centreX(el: any): number {
  return el.x + (el.width || 0) / 2;
}

/** Centre-Y of an element. */
function centreY(el: any): number {
  return el.y + (el.height || 0) / 2;
}

/** Compute the variance of an array of numbers. */
function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/** Check if all waypoints of a connection form strictly orthogonal segments. */
function isOrthogonal(conn: any): boolean {
  const wps = conn.waypoints;
  if (!wps || wps.length < 2) return false;
  for (let i = 1; i < wps.length; i++) {
    const dx = Math.abs(wps[i].x - wps[i - 1].x);
    const dy = Math.abs(wps[i].y - wps[i - 1].y);
    const isHorizontal = dy < 1;
    const isVertical = dx < 1;
    if (!isHorizontal && !isVertical) return false;
  }
  return true;
}

/** Main-path element IDs in left-to-right order. */
const MAIN_PATH_IDS = [
  'Start_1',
  'Task_Review',
  'Gateway_Valid',
  'Task_Process',
  'Gateway_Split',
  'Gateway_Join',
  'Task_Confirm',
  'End_Success',
];

/** Main-path flow IDs for orthogonality checks. */
const MAIN_PATH_FLOW_IDS = new Set([
  'Flow_1',
  'Flow_2',
  'Flow_Yes',
  'Flow_3',
  'Flow_Ship',
  'Flow_Invoice',
  'Flow_ShipDone',
  'Flow_InvDone',
  'Flow_4',
  'Flow_5',
]);

/**
 * Import reference.bpmn, apply a node-placement strategy, run layout,
 * and collect quality metrics.
 */
async function runWithStrategy(strategy: Strategy): Promise<StrategyMetrics> {
  const importResult = JSON.parse(
    (await handleImportXml({ filePath: FIXTURE_PATH })).content[0].text as string
  );
  const diagramId = importResult.diagramId;

  // Patch ELK options with the target strategy
  ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = strategy;

  await handleLayoutDiagram({ diagramId });

  const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');

  // Collect main-path elements
  const mainPathElements = MAIN_PATH_IDS.map((id) => reg.get(id)).filter(Boolean);

  // Y-variance of main-path centres (lower = better alignment)
  const mainPathYs = mainPathElements.map((el: any) => centreY(el));
  const yVariance = variance(mainPathYs);

  // Diagram bounding box (all visible shapes)
  const shapes = reg.filter(
    (el: any) =>
      !el.type?.includes('SequenceFlow') &&
      !el.type?.includes('MessageFlow') &&
      !el.type?.includes('Association') &&
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      el.type !== 'bpmndi:BPMNDiagram' &&
      el.type !== 'bpmndi:BPMNPlane' &&
      (el.width || 0) > 0
  );

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of shapes) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    const right = s.x + (s.width || 0);
    const bottom = s.y + (s.height || 0);
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  const diagramWidth = maxX - minX;
  const diagramHeight = maxY - minY;

  // Parallel branches on distinct Y rows
  const ship = reg.get('Task_Ship');
  const invoice = reg.get('Task_Invoice');
  const parallelBranchesDistinct =
    ship && invoice ? Math.abs(centreY(ship) - centreY(invoice)) > 10 : false;

  // Orthogonality of main-path flows
  const connections = reg.filter((el: any) => el.type === 'bpmn:SequenceFlow');
  const mainPathConns = connections.filter((c: any) => MAIN_PATH_FLOW_IDS.has(c.id));
  const allMainPathOrthogonal = mainPathConns.every((c: any) => isOrthogonal(c));

  // Left-to-right ordering validation
  let leftToRightValid = true;
  for (let i = 1; i < mainPathElements.length; i++) {
    if (centreX(mainPathElements[i]) <= centreX(mainPathElements[i - 1])) {
      leftToRightValid = false;
      break;
    }
  }

  return {
    strategy,
    yVariance,
    diagramWidth,
    diagramHeight,
    parallelBranchesDistinct,
    allMainPathOrthogonal,
    leftToRightValid,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ELK node-placement strategy benchmark', () => {
  let originalStrategy: string | undefined;

  beforeEach(() => {
    clearDiagrams();
    originalStrategy = ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'];
  });

  afterEach(() => {
    // Always restore the original strategy
    if (originalStrategy !== undefined) {
      ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'] = originalStrategy;
    } else {
      delete ELK_LAYOUT_OPTIONS['elk.layered.nodePlacement.strategy'];
    }
    clearDiagrams();
  });

  const strategies: Strategy[] = ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'];

  for (const strategy of strategies) {
    it(`${strategy}: produces valid left-to-right layout`, async () => {
      const metrics = await runWithStrategy(strategy);

      // Log metrics for human review
      console.error(`\n── ${strategy} ──`);
      console.error(`  Y-variance (main path): ${metrics.yVariance.toFixed(2)}`);
      console.error(
        `  Diagram size:           ${metrics.diagramWidth.toFixed(0)} × ${metrics.diagramHeight.toFixed(0)}`
      );
      console.error(`  Parallel branches distinct: ${metrics.parallelBranchesDistinct}`);
      console.error(`  Main-path orthogonal:       ${metrics.allMainPathOrthogonal}`);
      console.error(`  Left-to-right valid:        ${metrics.leftToRightValid}`);

      // All strategies must produce valid left-to-right ordering
      expect(metrics.leftToRightValid).toBe(true);
    });
  }

  it('comparative summary of all strategies', async () => {
    const results: StrategyMetrics[] = [];

    for (const strategy of strategies) {
      clearDiagrams();
      const metrics = await runWithStrategy(strategy);
      results.push(metrics);
    }

    // Print comparison table
    console.error('\n╔══════════════════════════════════════════════════════════════════╗');
    console.error('║          ELK Node-Placement Strategy Benchmark                  ║');
    console.error('╠══════════════════════╦═══════════╦═══════════╦════════╦═════════╣');
    console.error('║ Strategy             ║ Y-Var     ║ Size WxH  ║ Branch ║ Ortho   ║');
    console.error('╠══════════════════════╬═══════════╬═══════════╬════════╬═════════╣');
    for (const m of results) {
      const name = m.strategy.padEnd(20);
      const yVar = m.yVariance.toFixed(1).padStart(7);
      const size = `${m.diagramWidth.toFixed(0)}×${m.diagramHeight.toFixed(0)}`.padStart(9);
      const branch = m.parallelBranchesDistinct ? '  ✓   ' : '  ✗   ';
      const ortho = m.allMainPathOrthogonal ? '  ✓    ' : '  ✗    ';
      console.error(`║ ${name} ║ ${yVar}   ║ ${size} ║${branch}║${ortho}║`);
    }
    console.error('╚══════════════════════╩═══════════╩═══════════╩════════╩═════════╝');

    // Find the best strategy by lowest Y-variance (with left-to-right as a prerequisite)
    const valid = results.filter((r) => r.leftToRightValid);
    expect(valid.length).toBeGreaterThan(0);

    const best = valid.reduce((a, b) => (a.yVariance < b.yVariance ? a : b));
    console.error(
      `\n  Best strategy (lowest Y-variance): ${best.strategy} (${best.yVariance.toFixed(2)})`
    );

    // All strategies should produce valid layouts
    for (const m of results) {
      expect(m.leftToRightValid, `${m.strategy} failed left-to-right ordering`).toBe(true);
    }
  });
});
