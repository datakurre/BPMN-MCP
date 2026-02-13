/**
 * Machine-readable error codes for MCP tool failures.
 *
 * Each error code is a short, stable string that callers can match on
 * without parsing human-readable messages. The codes are passed in the
 * `data` field of `McpError` as `{ code: string }`.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ── Error code constants ───────────────────────────────────────────────────

/** Missing or null required parameter. */
export const ERR_MISSING_REQUIRED = 'MISSING_REQUIRED';

/** Parameter value is not in the allowed set (e.g. invalid element type). */
export const ERR_INVALID_ENUM = 'INVALID_ENUM';

/** Two or more parameters cannot be used together. */
export const ERR_ILLEGAL_COMBINATION = 'ILLEGAL_COMBINATION';

/** A referenced element or diagram was not found. */
export const ERR_NOT_FOUND = 'NOT_FOUND';

/** A referenced diagram was not found. */
export const ERR_DIAGRAM_NOT_FOUND = 'DIAGRAM_NOT_FOUND';

/** A referenced element was not found. */
export const ERR_ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND';

/** The element type does not support this operation. */
export const ERR_TYPE_MISMATCH = 'TYPE_MISMATCH';

/** A uniqueness constraint was violated (e.g. ensureUnique). */
export const ERR_DUPLICATE = 'DUPLICATE';

/** Export produced invalid output. */
export const ERR_EXPORT_FAILED = 'EXPORT_FAILED';

/** Lint validation blocks the operation. */
export const ERR_LINT_BLOCKED = 'LINT_BLOCKED';

/** A semantic rule was violated (e.g. MessageFlow requires cross-pool). */
export const ERR_SEMANTIC_VIOLATION = 'SEMANTIC_VIOLATION';

/** An internal / unexpected error. */
export const ERR_INTERNAL = 'INTERNAL';

// ── Factory helpers ────────────────────────────────────────────────────────

/**
 * Create an `McpError` with a machine-readable error code in `data`.
 *
 * @param mcpCode - MCP SDK error code (InvalidParams, InvalidRequest, etc.)
 * @param message - Human-readable description
 * @param errorCode - Machine-readable error code string
 * @param extra - Additional structured data to include
 */
export function createMcpError(
  mcpCode: number,
  message: string,
  errorCode: string,
  extra?: Record<string, unknown>
): McpError {
  return new McpError(mcpCode, message, { code: errorCode, ...extra });
}

// ── Convenience factories for common patterns ──────────────────────────────

export function missingRequiredError(params: string[]): McpError {
  return createMcpError(
    ErrorCode.InvalidParams,
    `Missing required argument(s): ${params.join(', ')}`,
    ERR_MISSING_REQUIRED,
    { params }
  );
}

export function diagramNotFoundError(diagramId: string): McpError {
  return createMcpError(
    ErrorCode.InvalidRequest,
    `Diagram not found: ${diagramId}`,
    ERR_DIAGRAM_NOT_FOUND,
    { diagramId }
  );
}

export function elementNotFoundError(elementId: string): McpError {
  return createMcpError(
    ErrorCode.InvalidRequest,
    `Element not found: ${elementId}. Use list_bpmn_elements to see available element IDs.`,
    ERR_ELEMENT_NOT_FOUND,
    { elementId }
  );
}

export function invalidEnumError(param: string, value: string, allowed: string[]): McpError {
  return createMcpError(
    ErrorCode.InvalidParams,
    `Invalid value "${value}" for ${param}. Allowed: ${allowed.join(', ')}`,
    ERR_INVALID_ENUM,
    { param, value, allowed }
  );
}

export function illegalCombinationError(message: string, params?: string[]): McpError {
  return createMcpError(ErrorCode.InvalidParams, message, ERR_ILLEGAL_COMBINATION, {
    ...(params ? { params } : {}),
  });
}

export function typeMismatchError(
  elementId: string,
  actualType: string,
  expectedTypes: string[]
): McpError {
  return createMcpError(
    ErrorCode.InvalidRequest,
    `Element ${elementId} is ${actualType}, but this operation requires: ${expectedTypes.join(', ')}`,
    ERR_TYPE_MISMATCH,
    { elementId, actualType, expectedTypes }
  );
}

export function duplicateError(message: string, existingIds?: string[]): McpError {
  return createMcpError(ErrorCode.InvalidRequest, message, ERR_DUPLICATE, {
    ...(existingIds ? { existingIds } : {}),
  });
}

export function semanticViolationError(message: string): McpError {
  return createMcpError(ErrorCode.InvalidRequest, message, ERR_SEMANTIC_VIOLATION);
}

export function exportFailedError(message: string): McpError {
  return createMcpError(ErrorCode.InternalError, message, ERR_EXPORT_FAILED);
}
