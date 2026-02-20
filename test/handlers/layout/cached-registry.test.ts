/**
 * Tests for CachedElementRegistry (H4).
 *
 * Verifies that the cached wrapper reduces getAll() invocations while
 * keeping element position changes visible (live references).
 */

import { describe, test, expect, vi } from 'vitest';
import { CachedElementRegistry } from '../../../src/elk/cached-registry';
import type { BpmnElement, ElementRegistry } from '../../../src/bpmn-types';

function makeElement(id: string, x = 0, y = 0): BpmnElement {
  return {
    id,
    type: 'bpmn:Task',
    businessObject: { $type: 'bpmn:Task', id },
    x,
    y,
    width: 100,
    height: 80,
  } as BpmnElement;
}

function makeRegistry(elements: BpmnElement[]): ElementRegistry {
  return {
    getAll: vi.fn(() => [...elements]),
    filter: vi.fn((fn: (el: BpmnElement) => boolean) => elements.filter(fn)),
    get: vi.fn((id: string) => elements.find((e) => e.id === id)),
    forEach: vi.fn((fn: (el: BpmnElement) => void) => elements.forEach(fn)),
  };
}

describe('CachedElementRegistry (H4)', () => {
  test('getAll() returns elements on first call', () => {
    const el = makeElement('t1');
    const inner = makeRegistry([el]);
    const cached = new CachedElementRegistry(inner);

    const result = cached.getAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  test('getAll() returns same array instance on repeated calls (no re-allocation)', () => {
    const elements = [makeElement('a'), makeElement('b')];
    const inner = makeRegistry(elements);
    const cached = new CachedElementRegistry(inner);

    const first = cached.getAll();
    const second = cached.getAll();

    // Same array reference — no re-allocation
    expect(first).toBe(second);
    // Inner.getAll() called only once
    expect(inner.getAll).toHaveBeenCalledTimes(1);
  });

  test('filter() uses cached list (inner.getAll() not called again)', () => {
    const elements = [makeElement('x'), makeElement('y')];
    const inner = makeRegistry(elements);
    const cached = new CachedElementRegistry(inner);

    // Populate cache
    cached.getAll();
    // filter() should NOT call inner.getAll() again
    const result = cached.filter((el) => el.id === 'x');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('x');
    expect(inner.getAll).toHaveBeenCalledTimes(1);
  });

  test('invalidate() clears cache so next getAll() re-fetches', () => {
    const elements = [makeElement('a')];
    const inner = makeRegistry(elements);
    const cached = new CachedElementRegistry(inner);

    cached.getAll(); // populate cache
    cached.invalidate(); // clear
    cached.getAll(); // re-fetch

    expect(inner.getAll).toHaveBeenCalledTimes(2);
  });

  test('get() delegates to inner registry (no caching)', () => {
    const el = makeElement('t1');
    const inner = makeRegistry([el]);
    const cached = new CachedElementRegistry(inner);

    const result = cached.get('t1');
    expect(result?.id).toBe('t1');
    expect(inner.get).toHaveBeenCalledWith('t1');
  });

  test('position changes are visible through cached array (live references)', () => {
    const el = makeElement('m', 100, 200);
    const elements = [el];
    const inner: ElementRegistry = {
      getAll: () => elements,
      filter: (fn) => elements.filter(fn),
      get: (id) => elements.find((e) => e.id === id),
      forEach: (fn) => elements.forEach(fn),
    };
    const cached = new CachedElementRegistry(inner);

    // Populate cache
    cached.getAll();

    // Simulate modeling.moveElements() mutating the element in-place
    el.x = 300;
    el.y = 400;

    // The cached array should see the updated position
    const result = cached.getAll();
    expect(result[0].x).toBe(300);
    expect(result[0].y).toBe(400);
  });

  test('forEach() iterates over all elements', () => {
    const elements = [makeElement('a'), makeElement('b'), makeElement('c')];
    const inner = makeRegistry(elements);
    const cached = new CachedElementRegistry(inner);

    const seen: string[] = [];
    cached.forEach((el) => seen.push(el.id));

    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
