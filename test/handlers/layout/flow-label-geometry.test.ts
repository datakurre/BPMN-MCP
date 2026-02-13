/**
 * Tests for L-shaped and Z-shaped flow label positioning.
 */

import { describe, test, expect } from 'vitest';
import {
  computeFlowMidpoint,
  findPreferredLabelSegmentIndex,
} from '../../../src/handlers/layout/labels/flow-label-geometry';

describe('findPreferredLabelSegmentIndex', () => {
  test('returns segment 1 for horizontal-then-vertical L-shape', () => {
    // L-shape: horizontal → vertical
    const waypoints = [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 400 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(1);
  });

  test('returns segment 0 for vertical-then-horizontal L-shape', () => {
    // L-shape: vertical → horizontal
    const waypoints = [
      { x: 100, y: 200 },
      { x: 100, y: 400 },
      { x: 300, y: 400 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(0);
  });

  test('returns segment 1 for H-V-H Z-shape', () => {
    // Z-shape: horizontal → vertical → horizontal
    const waypoints = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 350 },
      { x: 350, y: 350 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(1);
  });

  test('returns segment 1 for V-H-V Z-shape', () => {
    // Z-shape: vertical → horizontal → vertical
    const waypoints = [
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 350, y: 200 },
      { x: 350, y: 350 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(1);
  });

  test('returns -1 for a straight 2-waypoint flow', () => {
    const waypoints = [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(-1);
  });

  test('returns -1 for a 5-waypoint complex flow', () => {
    const waypoints = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 400 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(-1);
  });

  test('returns -1 for a diagonal 3-waypoint flow (non-orthogonal)', () => {
    // Neither segment is purely horizontal or vertical
    const waypoints = [
      { x: 100, y: 200 },
      { x: 250, y: 300 },
      { x: 400, y: 200 },
    ];
    expect(findPreferredLabelSegmentIndex(waypoints)).toBe(-1);
  });
});

describe('computeFlowMidpoint', () => {
  test('returns geometric center adjusted for arrow head on 2-waypoint flow', () => {
    const waypoints = [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];
    const mid = computeFlowMidpoint(waypoints);
    // Arrow head is 5px; effective end = 295, midpoint = (100 + 295) / 2 = 197.5
    expect(mid.x).toBeCloseTo(197.5, 1);
    expect(mid.y).toBe(200);
  });

  test('places midpoint on vertical segment for H→V L-shape', () => {
    // L-shape: horizontal (100,200)→(300,200) then vertical (300,200)→(300,400)
    const waypoints = [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 400 },
    ];
    const mid = computeFlowMidpoint(waypoints);
    // Should be at center of vertical segment: x=300, y=300
    expect(mid.x).toBe(300);
    expect(mid.y).toBe(300);
  });

  test('places midpoint on vertical segment for V→H L-shape', () => {
    // L-shape: vertical (100,200)→(100,400) then horizontal (100,400)→(300,400)
    const waypoints = [
      { x: 100, y: 200 },
      { x: 100, y: 400 },
      { x: 300, y: 400 },
    ];
    const mid = computeFlowMidpoint(waypoints);
    // Should be at center of vertical segment: x=100, y=300
    expect(mid.x).toBe(100);
    expect(mid.y).toBe(300);
  });

  test('places midpoint on middle segment for H→V→H Z-shape', () => {
    // Z-shape: horizontal → vertical → horizontal
    const waypoints = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 400 },
      { x: 350, y: 400 },
    ];
    const mid = computeFlowMidpoint(waypoints);
    // Should be at center of middle segment: x=200, y=300
    expect(mid.x).toBe(200);
    expect(mid.y).toBe(300);
  });

  test('uses path-midpoint fallback for 5+ waypoints', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ];
    const mid = computeFlowMidpoint(waypoints);
    // Total path = 400, arrow-adjusted half = (400 - 5) / 2 = 197.5
    // After first segment (100): walked=100
    // Into second segment: need 97.5 more out of 100 → t=0.975
    // → y = 0 + 100 * 0.975 = 97.5
    expect(mid.x).toBe(100);
    expect(mid.y).toBeCloseTo(97.5, 1);
  });
});
