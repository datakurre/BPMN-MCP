/**
 * MCP Resources — stable, addressable read-context endpoints.
 *
 * Exposes diagram data as MCP resources so AI callers can re-ground
 * context mid-conversation without tool calls:
 *
 *   bpmn://diagrams             — list all in-memory diagrams
 *   bpmn://diagram/{id}/summary — lightweight diagram summary
 *   bpmn://diagram/{id}/lint    — validation issues + fix suggestions
 *   bpmn://diagram/{id}/variables — process variable references
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAllDiagrams, getDiagram } from './diagram-manager';
import { handleSummarizeDiagram } from './handlers/core/summarize-diagram';
import { handleValidate } from './handlers/core/validate';
import { handleListProcessVariables } from './handlers/core/list-process-variables';
import { handleListDiagrams } from './handlers/core/list-diagrams';

/** Resource template definitions for bpmn:// URIs. */
export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/summary',
    name: 'Diagram summary',
    description:
      'Lightweight summary of a BPMN diagram: process name, element counts by type, ' +
      'participant/lane names, named elements, and connectivity stats.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/lint',
    name: 'Diagram validation',
    description:
      'bpmnlint validation issues with severities, fix suggestions, and structured tool call hints.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/variables',
    name: 'Process variables',
    description:
      'All process variables referenced in the diagram with read/write access patterns and source elements.',
    mimeType: 'application/json',
  },
];

/**
 * List all currently available concrete resources.
 * Returns a `bpmn://diagrams` entry plus per-diagram resources.
 */
export function listResources(): any[] {
  const diagrams = getAllDiagrams();
  const resources: any[] = [];

  // Static resource: diagram list
  resources.push({
    uri: 'bpmn://diagrams',
    name: 'All diagrams',
    description: `List of all ${diagrams.size} in-memory BPMN diagrams`,
    mimeType: 'application/json',
  });

  // Per-diagram resources
  for (const [id, state] of diagrams) {
    const name = state.name || '(unnamed)';
    resources.push({
      uri: `bpmn://diagram/${id}/summary`,
      name: `${name} — summary`,
      description: `Lightweight summary of diagram "${name}"`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/lint`,
      name: `${name} — validation`,
      description: `Validation issues for diagram "${name}"`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/variables`,
      name: `${name} — variables`,
      description: `Process variables in diagram "${name}"`,
      mimeType: 'application/json',
    });
  }

  return resources;
}

/** Extract the text content from a handler ToolResult. */
function extractText(result: any): string {
  if (result?.content?.[0]?.text) return result.content[0].text;
  return JSON.stringify(result);
}

/**
 * Read a specific resource by URI.
 * Returns `{ contents: [{ uri, mimeType, text }] }`.
 */
export async function readResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // bpmn://diagrams
  if (uri === 'bpmn://diagrams') {
    const result = await handleListDiagrams();
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/summary
  const summaryMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/summary$/);
  if (summaryMatch) {
    const diagramId = summaryMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleSummarizeDiagram({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/lint
  const lintMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/lint$/);
  if (lintMatch) {
    const diagramId = lintMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleValidate({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/variables
  const varsMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/variables$/);
  if (varsMatch) {
    const diagramId = varsMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleListProcessVariables({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}

/** Validate that a diagram ID exists, throwing McpError if not. */
function ensureDiagramExists(diagramId: string): void {
  if (!getDiagram(diagramId)) {
    throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
  }
}
