/**
 * Headless browser environment for bpmn-js.
 *
 * Creates a jsdom instance with all SVG / CSS polyfills required to run the
 * bpmn-js browser bundle outside of a real browser.  The instance is lazily
 * initialised on first call and then reused.
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';

let jsdomInstance: any;
let BpmnModelerCtor: any;

/** Ensure the jsdom instance + polyfills exist and return the canvas element. */
export function createHeadlessCanvas(): HTMLElement {
  if (!jsdomInstance) {
    const bpmnJsPath = require.resolve('bpmn-js/dist/bpmn-modeler.development.js');
    const bpmnJsBundle = fs.readFileSync(bpmnJsPath, 'utf-8');

    jsdomInstance = new JSDOM("<!DOCTYPE html><html><body><div id='canvas'></div></body></html>", {
      runScripts: 'outside-only',
    });

    applyPolyfills(jsdomInstance);

    // Execute the bpmn-js bundle inside jsdom
    jsdomInstance.window.eval(bpmnJsBundle);

    // Expose globals that bpmn-js expects at runtime
    (global as any).document = jsdomInstance.window.document;
    (global as any).window = jsdomInstance.window;

    BpmnModelerCtor = (jsdomInstance.window as any).BpmnJS;
  }

  return jsdomInstance.window.document.getElementById('canvas')!;
}

/** Return the lazily-loaded BpmnModeler constructor. */
export function getBpmnModeler(): any {
  if (!BpmnModelerCtor) {
    createHeadlessCanvas(); // triggers lazy init
  }
  return BpmnModelerCtor;
}

// ---------------------------------------------------------------------------
// Polyfills
// ---------------------------------------------------------------------------

/** Polyfill CSS.escape, structuredClone, and SVGMatrix on the jsdom window. */
function applyGlobalPolyfills(win: any): void {
  win.CSS = {
    escape: (str: string) => str.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&'),
  };

  if (!win.structuredClone) {
    win.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
  }

  win.SVGMatrix = function () {
    return {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse() {
        return this;
      },
      multiply() {
        return this;
      },
      translate(x: number, y: number) {
        this.e += x;
        this.f += y;
        return this;
      },
      scale(s: number) {
        this.a *= s;
        this.d *= s;
        return this;
      },
    };
  };
}

/** Polyfill SVGElement methods: getBBox, getScreenCTM, transform. */
function applySvgElementPolyfills(win: any): void {
  const SVGElement = win.SVGElement;
  const SVGGraphicsElement = win.SVGGraphicsElement;

  if (SVGElement && !SVGElement.prototype.getBBox) {
    SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
  }

  if (SVGElement && !SVGElement.prototype.getScreenCTM) {
    SVGElement.prototype.getScreenCTM = function () {
      return {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse() {
          return this;
        },
        multiply() {
          return this;
        },
        translate() {
          return this;
        },
      };
    };
  }

  const transformProp = {
    get(this: any): any {
      if (!this._transform) {
        const list = createTransformList();
        this._transform = { baseVal: list, animVal: list };
      }
      return this._transform;
    },
  };

  if (SVGGraphicsElement) {
    Object.defineProperty(SVGGraphicsElement.prototype, 'transform', transformProp);
  }
  if (SVGElement) {
    Object.defineProperty(SVGElement.prototype, 'transform', transformProp);
  }
}

/** Polyfill SVGSVGElement.createSVGMatrix and createSVGTransform. */
function applySvgSvgElementPolyfills(win: any): void {
  const SVGSVGElement = win.SVGSVGElement;
  if (!SVGSVGElement) return;

  if (!SVGSVGElement.prototype.createSVGMatrix) {
    SVGSVGElement.prototype.createSVGMatrix = function () {
      return {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse() {
          return this;
        },
        multiply() {
          return this;
        },
        translate() {
          return this;
        },
        scale() {
          return this;
        },
      };
    };
  }
  if (!SVGSVGElement.prototype.createSVGTransform) {
    SVGSVGElement.prototype.createSVGTransform = function () {
      return {
        type: 0,
        matrix: this.createSVGMatrix(),
        angle: 0,
        setMatrix() {},
        setTranslate() {},
        setScale() {},
        setRotate() {},
      };
    };
  }
}

function applyPolyfills(instance: any): void {
  const win = instance.window;
  applyGlobalPolyfills(win);
  applySvgElementPolyfills(win);
  applySvgSvgElementPolyfills(win);
}

function createTransformList() {
  return {
    numberOfItems: 0,
    _items: [] as any[],
    consolidate() {
      return null;
    },
    clear() {
      this._items = [];
      this.numberOfItems = 0;
    },
    initialize(newItem: any) {
      this._items = [newItem];
      this.numberOfItems = 1;
      return newItem;
    },
    getItem(index: number) {
      return this._items[index];
    },
    insertItemBefore(newItem: any, index: number) {
      this._items.splice(index, 0, newItem);
      this.numberOfItems = this._items.length;
      return newItem;
    },
    replaceItem(newItem: any, index: number) {
      this._items[index] = newItem;
      return newItem;
    },
    removeItem(index: number) {
      const item = this._items.splice(index, 1)[0];
      this.numberOfItems = this._items.length;
      return item;
    },
    appendItem(newItem: any) {
      this._items.push(newItem);
      this.numberOfItems = this._items.length;
      return newItem;
    },
    createSVGTransformFromMatrix(matrix: any) {
      return { type: 1, matrix, angle: 0 };
    },
  };
}
