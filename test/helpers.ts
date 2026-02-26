/**
 * Barrel re-export from focused test utility modules.
 *
 * Core diagram utilities (used by ~100 test files) are in `utils/diagram.ts`.
 *
 * New tests should import directly from `./utils/diagram`.
 * This barrel exists for backwards compatibility.
 */

// Core diagram helpers (used by the majority of tests)
export {
  parseResult,
  createDiagram,
  addElement,
  connect,
  connectAll,
  exportXml,
  getRegistry,
  createSimpleProcess,
  clearDiagrams,
} from './utils/diagram';
