/**
 * Prompt definitions for MCP prompts.
 *
 * Separated from prompts.ts to keep file sizes under the lint limit.
 * Each prompt provides step-by-step instructions for a common BPMN pattern.
 */

/** Reusable interface for prompt definitions. */
export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>
  ) => Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

/** Default placeholder for diagram IDs. */
const DEFAULT_DIAGRAM_ID = '<diagramId>';

/** Default placeholder for element IDs. */
const DEFAULT_ELEMENT_ID = '<elementId>';

// ── Error handling prompt ──────────────────────────────────────────────────

const addErrorHandlingPattern: PromptDefinition = {
  name: 'add-error-handling-pattern',
  title: 'Add error handling pattern',
  description:
    'Add error handling to a service task or subprocess using error boundary events, ' +
    'error end events, and optional retry/escalation paths. Covers both boundary event ' +
    'and event subprocess approaches.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID',
      required: true,
    },
    {
      name: 'targetElementId',
      description: 'The ID of the service task or subprocess to add error handling to',
      required: true,
    },
    {
      name: 'errorCode',
      description: 'The error code to catch (e.g. "PAYMENT_FAILED", "VALIDATION_ERROR")',
      required: false,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const targetId = args.targetElementId || DEFAULT_ELEMENT_ID;
    const errorCode = args.errorCode || 'ERROR_001';
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Add error handling to element "${targetId}" in diagram "${diagramId}" ` +
            `for error code "${errorCode}".\n\n` +
            `Follow these steps:\n\n` +
            `1. **Add error boundary event**: Use \`add_bpmn_element\` with:\n` +
            `   - elementType: "bpmn:BoundaryEvent"\n` +
            `   - hostElementId: "${targetId}"\n` +
            `   - eventDefinitionType: "bpmn:ErrorEventDefinition"\n` +
            `   - errorRef: { id: "Error_${errorCode}", name: "${errorCode}", ` +
            `errorCode: "${errorCode}" }\n` +
            `   - name: "${errorCode}"\n` +
            `2. **Add error handling path**: After the boundary event:\n` +
            `   - For retry: add a ServiceTask ("Retry Operation") with a loop or timer\n` +
            `   - For compensation: add tasks to undo/rollback the failed operation\n` +
            `   - For notification: add a SendTask ("Notify Error") to alert stakeholders\n` +
            `   - For escalation: add a UserTask ("Handle Error Manually") assigned to ` +
            `support\n` +
            `3. **End the error path**: Connect to an EndEvent (optionally an Error End ` +
            `Event to propagate the error to a parent process)\n` +
            `4. **Layout**: Run \`layout_bpmn_diagram\` to arrange the error handling path\n\n` +
            `**Advanced: Event subprocess approach** (for errors anywhere in a subprocess):\n` +
            `1. Create a \`bpmn:SubProcess\` and use \`set_bpmn_element_properties\` to set ` +
            `\`triggeredByEvent: true\` and \`isExpanded: true\`\n` +
            `2. Add a StartEvent with \`bpmn:ErrorEventDefinition\` inside the event ` +
            `subprocess\n` +
            `3. Add error handling tasks and an end event\n\n` +
            `**Best practices:**\n` +
            `- Use specific error codes to catch specific errors (not catch-all)\n` +
            `- Always provide a fallback path for unexpected errors\n` +
            `- Consider whether the error should interrupt the task (boundary event) ` +
            `or be handled in parallel (non-interrupting boundary event)\n` +
            `- For external tasks, configure \`camunda:ErrorEventDefinition\` on the ` +
            `ServiceTask to map worker errors to BPMN errors`,
        },
      },
    ];
  },
};

// ── Parallel tasks prompt ──────────────────────────────────────────────────

const addParallelTasksPattern: PromptDefinition = {
  name: 'add-parallel-tasks-pattern',
  title: 'Add parallel execution pattern',
  description:
    'Add a parallel gateway pattern: split into concurrent branches, execute tasks ' +
    'in parallel, and merge with a synchronizing parallel gateway. Includes best ' +
    'practices for parallel execution.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID',
      required: true,
    },
    {
      name: 'afterElementId',
      description: 'The ID of the element after which to add the parallel pattern',
      required: true,
    },
    {
      name: 'branches',
      description:
        'Comma-separated list of parallel branch names ' +
        '(e.g. "Check Inventory, Process Payment, Send Confirmation")',
      required: true,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const afterId = args.afterElementId || DEFAULT_ELEMENT_ID;
    const branches = args.branches
      ? args.branches.split(',').map((b) => b.trim())
      : ['Task A', 'Task B', 'Task C'];
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Add a parallel execution pattern after element "${afterId}" in diagram ` +
            `"${diagramId}" with these parallel branches: ${branches.join(', ')}.\n\n` +
            `Follow these steps:\n\n` +
            `1. **Add parallel split gateway**: Use \`add_bpmn_element\` with:\n` +
            `   - elementType: "bpmn:ParallelGateway"\n` +
            `   - name: "" (parallel gateways typically have no label)\n` +
            `   - afterElementId: "${afterId}"\n` +
            `2. **Add parallel branches**: For each branch, add a task:\n` +
            branches
              .map(
                (b, i) =>
                  `   - Branch ${i + 1}: Add a task named "${b}" ` +
                  `(choose UserTask, ServiceTask, etc. as appropriate)`
              )
              .join('\n') +
            `\n` +
            `3. **Connect split gateway to all branches**: Use \`connect_bpmn_elements\` ` +
            `to connect the parallel gateway to each branch task. Do NOT set conditions ` +
            `\u2014 parallel gateways take ALL outgoing flows unconditionally.\n` +
            `4. **Add parallel merge gateway**: Add another \`bpmn:ParallelGateway\` after ` +
            `the branch tasks to synchronize all branches.\n` +
            `5. **Connect branches to merge gateway**: Connect each branch task to the ` +
            `merge gateway.\n` +
            `6. **Continue the flow**: Connect the merge gateway to the next element.\n` +
            `7. **Layout**: Run \`layout_bpmn_diagram\` to arrange the parallel structure.\n\n` +
            `**Best practices:**\n` +
            `- Always use a ParallelGateway (not ExclusiveGateway) for the merge \u2014 ` +
            `the merge waits for ALL branches to complete before continuing.\n` +
            `- Do NOT set conditions on outgoing flows of parallel gateways.\n` +
            `- Do NOT set a default flow on parallel gateways.\n` +
            `- Each branch is independent \u2014 no sequence flows between parallel branches.\n` +
            `- If a branch has multiple tasks, connect them in sequence within the branch.\n` +
            `- Consider adding error boundary events on tasks that might fail.`,
        },
      },
    ];
  },
};

/** Additional prompts defined in this module. */
export const ADDITIONAL_PROMPTS: PromptDefinition[] = [
  addErrorHandlingPattern,
  addParallelTasksPattern,
];
