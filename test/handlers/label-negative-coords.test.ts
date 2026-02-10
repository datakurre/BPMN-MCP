/**
 * Tests for the negative-coordinate label penalty and boundary
 * sub-flow end-event alignment.
 */

import { describe, it, expect } from 'vitest';
import { scoreLabelPosition, type Rect, type Point } from '../../src/handlers/label-utils';

describe('Label scoring: negative coordinate penalty', () => {
  const noSegments: [Point, Point][] = [];
  const noLabels: Rect[] = [];

  it('penalises labels with negative X', () => {
    const rect: Rect = { x: -10, y: 50, width: 90, height: 20 };
    const score = scoreLabelPosition(rect, noSegments, noLabels);
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('penalises labels with negative Y', () => {
    const rect: Rect = { x: 50, y: -5, width: 90, height: 20 };
    const score = scoreLabelPosition(rect, noSegments, noLabels);
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('penalises labels with both negative X and Y', () => {
    const rect: Rect = { x: -100, y: -200, width: 90, height: 20 };
    const score = scoreLabelPosition(rect, noSegments, noLabels);
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('does not penalise labels at positive coordinates', () => {
    const rect: Rect = { x: 100, y: 200, width: 90, height: 20 };
    const score = scoreLabelPosition(rect, noSegments, noLabels);
    expect(score).toBe(0);
  });

  it('does not penalise labels at zero coordinates', () => {
    const rect: Rect = { x: 0, y: 0, width: 90, height: 20 };
    const score = scoreLabelPosition(rect, noSegments, noLabels);
    expect(score).toBe(0);
  });
});
