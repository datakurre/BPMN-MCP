/**
 * Shared helpers used by individual tool handler modules.
 *
 * This barrel re-exports from focused sub-modules for backwards compatibility.
 * New code should import directly from the specific module:
 *   - `./validation`      — validateArgs
 *   - `./id-generation`   — generateDescriptiveId, generateFlowId
 *   - `./diagram-access`  — requireDiagram, requireElement, jsonResult, syncXml, …
 *   - `./moddle-utils`    — upsertExtensionElement, createBusinessObject, fixConnectionId
 */

// Re-export getService for convenient typed access from handlers
export { getService } from '../bpmn-types';

// ── Error codes ────────────────────────────────────────────────────────────
export {
  ERR_MISSING_REQUIRED,
  ERR_INVALID_ENUM,
  ERR_ILLEGAL_COMBINATION,
  ERR_NOT_FOUND,
  ERR_DIAGRAM_NOT_FOUND,
  ERR_ELEMENT_NOT_FOUND,
  ERR_TYPE_MISMATCH,
  ERR_DUPLICATE,
  ERR_EXPORT_FAILED,
  ERR_LINT_BLOCKED,
  ERR_SEMANTIC_VIOLATION,
  ERR_INTERNAL,
  createMcpError,
  missingRequiredError,
  diagramNotFoundError,
  elementNotFoundError,
  invalidEnumError,
  illegalCombinationError,
  typeMismatchError,
  duplicateError,
  semanticViolationError,
  exportFailedError,
} from '../errors';

// ── Validation ─────────────────────────────────────────────────────────────
export { validateArgs } from './validation';

// ── ID generation ──────────────────────────────────────────────────────────
export { generateDescriptiveId, generateFlowId } from './id-generation';

// ── Diagram access, element filtering, counts, connectivity ────────────────
export {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  getVisibleElements,
  isConnectionElement,
  isInfrastructureElement,
  buildElementCounts,
  buildConnectivityWarnings,
} from './diagram-access';

// ── Moddle / extension-element utilities ───────────────────────────────────
export { upsertExtensionElement, createBusinessObject, fixConnectionId } from './moddle-utils';

// ── Root-element helpers ───────────────────────────────────────────────────
export {
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
} from './root-element-helpers';
