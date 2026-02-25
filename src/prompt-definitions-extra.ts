/**
 * Extra prompt definitions — subprocess and message exchange patterns.
 *
 * Split from prompt-definitions.ts to keep file sizes under the lint limit.
 */

import type { PromptDefinition } from './prompt-definitions';

/** Default placeholder for diagram IDs. */
const DEFAULT_DIAGRAM_ID = '<diagramId>';

/** Default placeholder for element IDs. */
const DEFAULT_ELEMENT_ID = '<elementId>';

// ── Subprocess pattern prompt ──────────────────────────────────────────────

export const addSubprocessPattern: PromptDefinition = {
  name: 'add-subprocess-pattern',
  title: 'Add embedded subprocess',
  description:
    'Add an embedded (expanded) subprocess to group related activities, with optional ' +
    'boundary events for error/timer handling. Covers both regular and event subprocesses.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID',
      required: true,
    },
    {
      name: 'afterElementId',
      description: 'The ID of the element after which to insert the subprocess',
      required: true,
    },
    {
      name: 'subprocessName',
      description: 'Name for the subprocess (e.g. "Process Payment", "Verify Identity")',
      required: true,
    },
    {
      name: 'steps',
      description:
        'Comma-separated list of steps inside the subprocess ' +
        '(e.g. "Validate Card, Charge Amount, Send Receipt")',
      required: false,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const afterId = args.afterElementId || DEFAULT_ELEMENT_ID;
    const spName = args.subprocessName || 'My Subprocess';
    const steps = args.steps
      ? args.steps.split(',').map((s) => s.trim())
      : ['Step 1', 'Step 2', 'Step 3'];
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Add an embedded subprocess called "${spName}" after element "${afterId}" ` +
            `in diagram "${diagramId}" with steps: ${steps.join(', ')}.\n\n` +
            `Follow these steps:\n\n` +
            `1. **Add the subprocess**: Use \`add_bpmn_element\` with:\n` +
            `   - elementType: "bpmn:SubProcess"\n` +
            `   - name: "${spName}"\n` +
            `   - afterElementId: "${afterId}"\n` +
            `   - isExpanded: true\n` +
            `2. **Add internal flow**: Inside the subprocess (use parentId = subprocess ID):\n` +
            `   - Add a StartEvent\n` +
            steps.map((s) => `   - Add a task named "${s}"\n`).join('') +
            `   - Add an EndEvent\n` +
            `   - Connect them in sequence with \`connect_bpmn_elements\`\n` +
            `3. **Add boundary events** (optional):\n` +
            `   - Timer: \`add_bpmn_element\` with elementType "bpmn:BoundaryEvent", ` +
            `hostElementId = subprocess ID, eventDefinitionType "bpmn:TimerEventDefinition"\n` +
            `   - Error: same but with "bpmn:ErrorEventDefinition" and an errorRef\n` +
            `4. **Connect boundary paths**: Add tasks/end events for each boundary event path\n` +
            `5. **Layout**: Run \`layout_bpmn_diagram\` to arrange the subprocess and its contents\n\n` +
            `**Event subprocess variant** (for handling events anywhere in the parent scope):\n` +
            `1. Add a \`bpmn:SubProcess\` with isExpanded: true\n` +
            `2. Use \`set_bpmn_element_properties\` to set \`triggeredByEvent: true\`\n` +
            `3. Add a StartEvent with the appropriate event definition (error, timer, message)\n` +
            `4. Add handling tasks and an end event inside the event subprocess\n\n` +
            `**Best practices:**\n` +
            `- Use subprocesses to group 3-7 related activities\n` +
            `- Name the subprocess with a verb-object pattern describing its purpose\n` +
            `- Prefer expanded subprocesses for readability (collapsed for space)\n` +
            `- Boundary events on subprocesses catch errors from ANY activity inside\n` +
            `- Event subprocesses are triggered by events, not by the normal flow`,
        },
      },
    ];
  },
};

// ── Message exchange pattern prompt ────────────────────────────────────────

export const addMessageExchangePattern: PromptDefinition = {
  name: 'add-message-exchange-pattern',
  title: 'Add message exchange between pools',
  description:
    'Create a collaboration diagram with message flows between participants (pools). ' +
    'Models inter-organization or inter-system communication using BPMN message events.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID (or omit to create a new diagram)',
      required: false,
    },
    {
      name: 'processName',
      description: 'Name for the main process (e.g. "Order Processing")',
      required: true,
    },
    {
      name: 'partnerName',
      description: 'Name of the external partner or system (e.g. "Payment Provider", "Supplier")',
      required: true,
    },
    {
      name: 'messagePairs',
      description:
        'Semicolon-separated message pairs as "sender>receiver:message" ' +
        '(e.g. "Order>Supplier:Purchase Order; Supplier>Order:Confirmation")',
      required: false,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const processName = args.processName || 'My Process';
    const partnerName = args.partnerName || 'External System';
    const pairs = args.messagePairs
      ? args.messagePairs.split(';').map((p) => p.trim())
      : [`${processName}>${partnerName}:Request`, `${partnerName}>${processName}:Response`];
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Create a collaboration diagram for "${processName}" communicating with ` +
            `"${partnerName}" via message flows` +
            (args.diagramId ? ` in diagram "${diagramId}"` : '') +
            `.\n\n` +
            `Message exchanges: ${pairs.join('; ')}\n\n` +
            `Follow these steps:\n\n` +
            `1. **Create/prepare diagram**:\n` +
            (args.diagramId
              ? `   - Use existing diagram "${diagramId}"\n` +
                `   - If it has existing elements, wrap them with ` +
                `\`create_bpmn_participant\` (wrapExisting: true)\n`
              : `   - Use \`create_bpmn_diagram\` with name "${processName}"\n`) +
            `2. **Create collaboration**: Use \`create_bpmn_participant\` with participants:\n` +
            `   - { name: "${processName}", collapsed: false } — the executable pool\n` +
            `   - { name: "${partnerName}", collapsed: true } — partner pool (collapsed)\n` +
            `   **Important:** In Camunda 7, only ONE pool is executable. Partner pools ` +
            `must be collapsed (thin bars) as documentation endpoints.\n` +
            `3. **Build the main process** inside the executable pool:\n` +
            `   - Add StartEvent, tasks, gateways, EndEvent\n` +
            `   - For sending messages: use \`bpmn:IntermediateThrowEvent\` or \`bpmn:SendTask\` ` +
            `with a MessageEventDefinition\n` +
            `   - For receiving messages: use \`bpmn:IntermediateCatchEvent\` or \`bpmn:ReceiveTask\` ` +
            `with a MessageEventDefinition\n` +
            `4. **Define messages**: Use \`manage_bpmn_root_elements\` to create shared ` +
            `bpmn:Message definitions for each message type\n` +
            `5. **Add message flows**: Use \`connect_bpmn_elements\` to draw message flows ` +
            `between the executable pool's message events and the collapsed partner pool. ` +
            `Message flows cross pool boundaries (auto-detected as bpmn:MessageFlow).\n` +
            `6. **Layout**: Run \`layout_bpmn_diagram\` to arrange the collaboration\n\n` +
            `**Best practices:**\n` +
            `- Use collapsed pools for external partners — they are NOT executable\n` +
            `- Never use sequence flows across pools — only message flows\n` +
            `- Each message event should reference a bpmn:Message root element\n` +
            `- For request-response patterns: throw event (send) → catch event (receive)\n` +
            `- For simple external calls without explicit message exchange, prefer ` +
            `ServiceTask with \`camunda:type="external"\` instead of message events\n` +
            `- Name messages clearly (e.g. "Purchase Order", "Invoice", "Shipment Notification")`,
        },
      },
    ];
  },
};
