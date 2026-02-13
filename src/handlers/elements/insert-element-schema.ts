/**
 * JSON Schema for the insert_bpmn_element tool.
 *
 * Extracted from insert-element.ts to keep the handler logic under max-lines.
 */

export const TOOL_DEFINITION = {
  name: 'insert_bpmn_element',
  description:
    'Insert a new element into an existing sequence flow, splitting the flow and reconnecting automatically. ' +
    'Accepts a flowId to split, the elementType to insert, and an optional name. ' +
    "The new element is positioned at the midpoint between the flow's source and target. " +
    'When source and target are horizontally aligned, alignment is preserved. ' +
    'When lanes are present and no laneId is specified, the element is auto-placed in the source lane ' +
    'to avoid landing in an unrelated middle lane for cross-lane flows. ' +
    'This is a common operation when modifying existing diagrams — it replaces the 3-step ' +
    'pattern of delete flow → add element → create two new flows.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      flowId: {
        type: 'string',
        description: 'The ID of the sequence flow to split',
      },
      elementType: {
        type: 'string',
        enum: [
          'bpmn:Task',
          'bpmn:UserTask',
          'bpmn:ServiceTask',
          'bpmn:ScriptTask',
          'bpmn:ManualTask',
          'bpmn:BusinessRuleTask',
          'bpmn:SendTask',
          'bpmn:ReceiveTask',
          'bpmn:CallActivity',
          'bpmn:ExclusiveGateway',
          'bpmn:ParallelGateway',
          'bpmn:InclusiveGateway',
          'bpmn:EventBasedGateway',
          'bpmn:IntermediateCatchEvent',
          'bpmn:IntermediateThrowEvent',
          'bpmn:SubProcess',
          'bpmn:StartEvent',
          'bpmn:EndEvent',
        ],
        description: 'The type of BPMN element to insert',
      },
      name: {
        type: 'string',
        description: 'The name/label for the inserted element',
      },
      laneId: {
        type: 'string',
        description:
          'Override automatic Y positioning by centering the element in the specified lane. ' +
          'When inserting into a cross-lane flow without this parameter, the element is auto-placed ' +
          "in the source element's lane. Use laneId to override this default.",
      },
    },
    required: ['diagramId', 'flowId', 'elementType'],
    examples: [
      {
        title: 'Insert an approval task into an existing flow',
        value: {
          diagramId: '<diagram-id>',
          flowId: 'Flow_SubmitToEnd',
          elementType: 'bpmn:UserTask',
          name: 'Approve Request',
        },
      },
      {
        title: 'Insert a decision gateway into an existing flow',
        value: {
          diagramId: '<diagram-id>',
          flowId: 'Flow_ReviewToProcess',
          elementType: 'bpmn:ExclusiveGateway',
          name: 'Order valid?',
        },
      },
    ],
  },
} as const;
