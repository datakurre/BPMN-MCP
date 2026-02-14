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
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/xml',
    name: 'Diagram XML',
    description:
      'Current BPMN 2.0 XML of the diagram. Useful for re-grounding context during iterative editing sessions.',
    mimeType: 'application/xml',
  },
];

/**
 * Static guide resources — always listed regardless of diagram state.
 * These provide stable reference material for AI callers.
 */
export const STATIC_RESOURCES = [
  {
    uri: 'bpmn://guides/executable-camunda7',
    name: 'Executable Camunda 7 / Operaton guide',
    description:
      'Constraints, conventions, and best practices for building executable BPMN processes ' +
      'targeting Camunda 7 (Operaton). Covers deployment, task types, forms, and common pitfalls.',
    mimeType: 'text/markdown',
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

  // Static guide resources (always available)
  resources.push(...STATIC_RESOURCES);

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
    resources.push({
      uri: `bpmn://diagram/${id}/xml`,
      name: `${name} — XML`,
      description: `BPMN 2.0 XML of diagram "${name}"`,
      mimeType: 'application/xml',
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

  // bpmn://diagram/{id}/xml
  const xmlMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/xml$/);
  if (xmlMatch) {
    const diagramId = xmlMatch[1];
    ensureDiagramExists(diagramId);
    const diagram = getDiagram(diagramId)!;
    return {
      contents: [{ uri, mimeType: 'application/xml', text: diagram.xml }],
    };
  }

  // bpmn://guides/executable-camunda7
  if (uri === 'bpmn://guides/executable-camunda7') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: EXECUTABLE_CAMUNDA7_GUIDE,
        },
      ],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}

/**
 * Static content for the executable Camunda 7 / Operaton guide.
 *
 * Provides AI callers with constraints and conventions for building
 * processes that can be deployed and executed on Camunda 7 / Operaton.
 */
const EXECUTABLE_CAMUNDA7_GUIDE = `# Executable BPMN for Camunda 7 / Operaton

## Deployment constraints

- **One executable pool per deployment.** In a collaboration diagram, only one
  participant may have \`isExecutable: true\`. Partner pools must be **collapsed**
  (thin bars) and serve only as message-flow endpoints.
- **Process ID = deployment key.** The \`id\` attribute on \`<bpmn:Process>\` is the
  process definition key used in API calls, REST endpoints, and tasklist queries.
  Use a stable, meaningful kebab-case or camelCase identifier (e.g.
  \`order-processing\`).
- **History time-to-live** is required. Set \`camunda:historyTimeToLive\` on the
  process element (e.g. \`"P30D"\` for 30 days).

## Task types

| BPMN type | Camunda usage | Key properties |
|-----------|---------------|----------------|
| **User Task** | Human work in Tasklist | \`camunda:assignee\`, \`camunda:candidateGroups\`, \`camunda:formKey\` or \`camunda:formRef\` or generated form fields |
| **Service Task (external)** | Polled by external workers | \`camunda:type="external"\`, \`camunda:topic\` |
| **Service Task (Java)** | In-process Java delegate | \`camunda:class\` or \`camunda:delegateExpression\` |
| **Service Task (connector)** | HTTP/REST via connector | \`camunda:connectorId\` |
| **Script Task** | Inline Groovy/JS/JUEL | \`scriptFormat\`, inline script, optional \`camunda:resultVariable\` |
| **Business Rule Task** | DMN decision | \`camunda:decisionRef\`, \`camunda:decisionRefBinding\`, \`camunda:mapDecisionResult\`, \`camunda:decisionRefVersion\` (when binding=version) |
| **Send Task** | Fire-and-forget message | \`camunda:type="external"\`, \`camunda:topic\` (like service task) |
| **Receive Task** | Wait for correlated message | Message reference + correlation key |
| **Call Activity** | Invoke another BPMN process | \`calledElement\`, \`camunda:calledElementBinding\` |

## User Task forms

- **Generated task forms** (\`set_bpmn_form_data\`): simple key/value fields
  embedded in the BPMN XML. Good for prototyping.
- **Camunda Platform Forms** (\`camunda:formRef\`): form designed separately
  (e.g. using @bpmn.io/form-js) and deployed alongside the process.
  Set \`camunda:formRefBinding\` (\`latest\`/\`deployment\`/\`version\`) to control
  version resolution. Use a companion \`form-js-mcp\` server if available
  to design the form.
- **Embedded forms** (\`camunda:formKey: "embedded:app:forms/myform.html"\`):
  custom HTML forms deployed with the application.
- **External forms** (\`camunda:formKey: "app:my-form"\`): separate
  frontend application handles rendering.

## Business Rule Task and DMN

Business Rule Tasks primarily integrate with DMN decision tables:
1. Deploy the DMN table separately (or use a companion \`dmn-js-mcp\` server
   if available to design it).
2. Set \`camunda:decisionRef\` to the decision table ID.
3. Set \`camunda:decisionRefBinding\` (\`latest\`/\`deployment\`/\`version\`)
   and \`camunda:mapDecisionResult\` (\`singleEntry\`/\`singleResult\`/
   \`collectEntries\`/\`resultList\`).
4. Use \`set_bpmn_input_output_mapping\` to map process variables to/from
   the decision input/output columns.

## External Task pattern

1. Set \`camunda:type="external"\` and \`camunda:topic="my-topic"\` on the
   Service Task.
2. Deploy an external task worker that polls for the topic and completes
   or fails the task.
3. For error handling, add \`camunda:ErrorEventDefinition\` entries on the
   service task (not boundary events) to map BPMN errors from worker failures.
4. Retry behavior is configured via \`camunda:asyncBefore\` /
   \`camunda:jobRetryTimeCycle\` or handled by the worker itself.

## Gateways and conditions

- **Exclusive gateway** (XOR): exactly one outgoing flow is taken. Every
  outgoing flow (except the default) must have a \`conditionExpression\`.
  Always mark one flow as \`isDefault: true\`.
- **Parallel gateway** (AND): all outgoing flows are taken. Do **not** set
  conditions. The merging gateway must also be parallel.
- **Inclusive gateway** (OR): one or more flows are taken based on conditions.
  Always set a default flow.
- **Event-based gateway**: waits for the first event to occur among
  intermediate catch events (message, timer, signal).
- Condition expressions use JUEL: \`\${amount > 1000}\`, \`\${approved == true}\`.

## Event handling patterns

- **Boundary events** (on tasks/subprocesses): handle exceptions at a
  specific activity. Interrupting stops the activity; non-interrupting
  lets it continue.
- **Event subprocesses**: handle exceptions anywhere within the parent
  scope. Interrupting cancels the scope; non-interrupting runs in parallel.
- **Timer events**: use ISO 8601 durations (\`PT15M\`, \`P2D\`), dates, or
  cycles (\`R3/PT10M\`).
- **Error events**: use error codes to match specific errors.
  \`bpmn:Error\` root elements define reusable error references.
- **Message events**: use message names for correlation.
  \`bpmn:Message\` root elements define reusable message references.

## Process decomposition strategies

### Call Activities (hierarchical)
- Break large processes into reusable subprocesses.
- Use \`camunda:calledElementBinding="deployment"\` for predictable behavior.
- Map variables with \`camunda:in\` / \`camunda:out\`.

### Message-based integration (distributed)
- Separate processes communicate via message events.
- Each process is independently deployable.
- Requires message correlation (business key or correlation keys).
- Model partner processes as collapsed pools in collaboration diagrams.

### Link events (within a single process)
- Use **Link throw/catch event pairs** to split a long flow into sections
  within the same process, improving readability without creating separate
  deployment units.
- Link events must have matching names (set via \`set_bpmn_event_definition\`
  with \`bpmn:LinkEventDefinition\` and \`properties: { name: "LinkName" }\`).
- Multiple throw events can target one catch event (many-to-one pattern).
- Useful for keeping everything in one file while avoiding long, tangled
  sequence flows.

## Common pitfalls

1. **Missing default flow on gateways** — always set \`isDefault: true\` on
   one outgoing flow of exclusive/inclusive gateways.
2. **Expanded partner pools** — only one pool is executable in Camunda 7.
   Use collapsed pools for partners.
3. **Implicit splits** — avoid conditional flows directly on tasks; use
   explicit gateways.
4. **Missing \`camunda:type="external"\`** — setting \`camunda:topic\`
   without \`camunda:type\` creates an invalid configuration.
5. **Parallel gateway merging exclusive paths** — use exclusive gateway
   to merge XOR branches.
6. **No history time-to-live** — Camunda 7 requires this on the process.
7. **Duplicate element names** — each flow node should have a unique name
   within its scope for clarity.
`;

/** Validate that a diagram ID exists, throwing McpError if not. */
function ensureDiagramExists(diagramId: string): void {
  if (!getDiagram(diagramId)) {
    throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
  }
}
