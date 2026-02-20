/**
 * H4: Cached element registry wrapper.
 *
 * During the ELK layout pipeline (20+ sequential steps), each step calls
 * `elementRegistry.getAll()` and/or `elementRegistry.filter()` independently.
 * bpmn-js's `ElementRegistry.getAll()` allocates a fresh array on every call
 * by iterating its internal `_elements` Map.  With 20+ steps and multiple
 * calls per step, a 100-element diagram incurs 50–100 array allocations.
 *
 * `CachedElementRegistry` wraps the real registry and caches the result of
 * `getAll()` after the first call.  Subsequent `getAll()` and `filter()`
 * calls operate on the cached array instead of reallocating.
 *
 * ## Safety
 * During layout, the set of elements in the diagram does not change
 * (elements are moved/resized but not added or removed by the pipeline).
 * The cached array contains live references — position mutations applied
 * by `modeling.moveElements()` are reflected immediately in element
 * objects without invalidating the array.
 *
 * ## Invalidation
 * Call `invalidate()` after any step that could add or remove elements
 * (e.g. after `expandCollapsedSubprocesses`).  The next `getAll()` will
 * re-fetch from the inner registry.
 *
 * ## Interface compatibility
 * `CachedElementRegistry` implements the full `ElementRegistry` interface,
 * so it can be passed to any function expecting `ElementRegistry` without
 * changes to those functions' signatures.
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

export class CachedElementRegistry implements ElementRegistry {
  private _cache: BpmnElement[] | null = null;

  constructor(private readonly inner: ElementRegistry) {}

  /**
   * Invalidate the cached element list.
   * Call after any operation that adds or removes elements from the registry
   * (e.g. `modeling.createShape`, `modeling.removeElements`).
   */
  invalidate(): void {
    this._cache = null;
  }

  /**
   * Return all elements.
   * Result is cached after the first call.  Subsequent calls return the
   * same array instance — elements within the array are live references.
   */
  getAll(): BpmnElement[] {
    if (!this._cache) {
      this._cache = this.inner.getAll();
    }
    return this._cache;
  }

  /**
   * Filter elements by predicate.
   * Operates on the cached element list (allocates a new filtered array,
   * but avoids the O(n) cost of re-fetching from the inner registry Map).
   */
  filter(fn: (element: BpmnElement) => boolean): BpmnElement[] {
    return this.getAll().filter(fn);
  }

  /**
   * Get a single element by ID.
   * Delegates to the inner registry which provides O(1) Map lookup.
   * Not cached — ID lookups are already fast and the element set may
   * change between calls (e.g. after `invalidate()`).
   */
  get(id: string): BpmnElement | undefined {
    return this.inner.get(id);
  }

  /**
   * Iterate over all elements.
   * Operates on the cached element list.
   */
  forEach(fn: (element: BpmnElement) => void): void {
    this.getAll().forEach(fn);
  }
}
