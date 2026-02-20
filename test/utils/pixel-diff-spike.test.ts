/**
 * I7-6: Pixel-level SVG diff tooling spike.
 *
 * Evaluates SVG-to-bitmap rendering options that work in Node.js.
 * This file documents the investigation and provides a proof-of-concept
 * for future pixel diff integration.
 *
 * FINDINGS:
 * - `sharp` + `svg-to-png` would work but adds a native binary dependency
 * - `@resvg/resvg-js` is a pure Wasm SVG renderer — no native compilation needed
 * - `puppeteer` is heavyweight (full Chrome) and slow for CI
 * - Recommended approach: `@resvg/resvg-js` for SVG→PNG, then `pixelmatch` for diff
 *
 * CURRENT STATUS: @resvg/resvg-js is not installed. The spike documents the
 * proposed API and falls back gracefully when the package is not available.
 * Install with: npm install --save-dev @resvg/resvg-js pixelmatch pngjs
 *
 * DECISION: Pixel-level diff adds significant CI complexity and binary deps.
 * The current position-based comparison (I7-2, I7-3) with tightened thresholds
 * is sufficient for regression detection. Pixel diff is deferred until position
 * comparison is insufficient.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, connect, clearDiagrams } from '../helpers';
import { handleExportBpmn } from '../../src/handlers';

describe('I7-6: Pixel-level SVG diff tooling spike', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('documents pixel diff approach: @resvg/resvg-js is not installed', async () => {
    // Attempt to import @resvg/resvg-js
    let resvgAvailable = false;
    try {
      await import('@resvg/resvg-js');
      resvgAvailable = true;
    } catch {
      resvgAvailable = false;
    }

    // @resvg/resvg-js is not installed as a dev dependency
    // To enable pixel diff: npm install --save-dev @resvg/resvg-js pixelmatch pngjs
    expect(resvgAvailable).toBe(false);
  });

  test('documents pixel diff approach: pixelmatch is not installed', async () => {
    let pixelmatchAvailable = false;
    try {
      await import('pixelmatch');
      pixelmatchAvailable = true;
    } catch {
      pixelmatchAvailable = false;
    }

    // pixelmatch is not installed as a dev dependency
    expect(pixelmatchAvailable).toBe(false);
  });

  test('SVG export produces valid SVG content for future pixel diff input', async () => {
    // Verify that our SVG export produces valid SVG content
    // that could be fed into a pixel diff tool
    const diagramId = await createDiagram('I7-6 Pixel Diff Spike');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'My Task', x: 350, y: 200 });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 550, y: 200 });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    const result = await handleExportBpmn({ format: 'svg', diagramId, skipLint: true });
    const svgContent = result.content[0].text;

    // Verify SVG structure
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('</svg>');
    expect(svgContent.length).toBeGreaterThan(100);

    // The SVG should contain viewBox for proper pixel rendering
    expect(svgContent).toMatch(/viewBox/i);
  });

  test('proposed pixel diff API (pseudocode documentation)', () => {
    /**
     * Proposed implementation when @resvg/resvg-js and pixelmatch are available:
     *
     * ```typescript
     * import { Resvg } from '@resvg/resvg-js';
     * import pixelmatch from 'pixelmatch';
     * import { PNG } from 'pngjs';
     *
     * async function computePixelDiff(
     *   referenceSvg: string,
     *   generatedSvg: string,
     *   width = 800,
     *   height = 600
     * ): Promise<{ diffPct: number; diffPng: Buffer }> {
     *   const opts = { fitTo: { mode: 'width' as const, value: width } };
     *
     *   const refPng = new Resvg(referenceSvg, opts).render().asPng();
     *   const genPng = new Resvg(generatedSvg, opts).render().asPng();
     *
     *   const refImg = PNG.sync.read(refPng);
     *   const genImg = PNG.sync.read(genPng);
     *   const diff = new PNG({ width, height });
     *
     *   const numDiffPixels = pixelmatch(
     *     refImg.data, genImg.data, diff.data,
     *     width, height,
     *     { threshold: 0.1 }
     *   );
     *
     *   const diffPct = (numDiffPixels / (width * height)) * 100;
     *   return { diffPct, diffPng: PNG.sync.write(diff) };
     * }
     *
     * // Usage in test:
     * const { diffPct } = await computePixelDiff(referenceSvg, generatedSvg);
     * expect(diffPct).toBeLessThan(5); // max 5% pixel diff
     * ```
     *
     * ADVANTAGES over position-based comparison:
     * - Catches label rendering issues, color changes, stroke width drifts
     * - Catches rotation/scaling artifacts
     * - Provides visual diff output for debugging
     *
     * DISADVANTAGES:
     * - Slower (PNG rendering)
     * - Fragile to font/rendering differences
     * - Large binary dependency (@resvg/resvg-js ~10MB Wasm)
     * - Reference SVGs need to be generated with the same renderer
     *
     * CONCLUSION: Defer pixel diff until position-based thresholds (I7-2, I7-3)
     * are stabilized. Position comparison catches layout regressions well.
     */
    expect(true).toBe(true); // Documentation test always passes
  });
});
