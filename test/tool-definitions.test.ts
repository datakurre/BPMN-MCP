import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';

/** Helper to extract typed inputSchema from a tool definition. */
function getSchema(tool: (typeof TOOL_DEFINITIONS)[number] | undefined) {
  return tool?.inputSchema as {
    type: string;
    required?: string[];
    properties?: Record<string, any>;
  };
}

describe('tool-definitions', () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  test('exports the expected number of tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(45);
  });

  test.each([
    'create_bpmn_diagram',
    'add_bpmn_element',
    'connect_bpmn_elements',
    'delete_bpmn_element',
    'move_bpmn_element',
    'get_bpmn_element_properties',
    'export_bpmn',
    'list_bpmn_elements',
    'set_bpmn_element_properties',
    'import_bpmn_xml',
    'delete_bpmn_diagram',
    'list_bpmn_diagrams',
    'validate_bpmn_diagram',
    'align_bpmn_elements',
    'set_bpmn_input_output_mapping',
    'set_bpmn_event_definition',
    'set_bpmn_form_data',
    'layout_bpmn_diagram',
    'set_bpmn_loop_characteristics',
    'bpmn_history',
    'batch_bpmn_operations',
    'set_bpmn_camunda_listeners',
    'set_bpmn_call_activity_variables',
    'manage_bpmn_root_elements',
    'create_bpmn_lanes',
    'create_bpmn_participant',
    'analyze_bpmn_lanes',
    'redistribute_bpmn_elements_across_lanes',
    'replace_bpmn_element',
    'list_bpmn_process_variables',
    'clone_bpmn_diagram',
    'diff_bpmn_diagrams',
    'duplicate_bpmn_element',
    'add_bpmn_element_chain',
    'set_bpmn_connection_waypoints',
    'set_bpmn_script',
    'adjust_bpmn_labels',
    'assign_bpmn_elements_to_lane',
    'wrap_bpmn_process_in_collaboration',
    'handoff_bpmn_to_lane',
    'suggest_bpmn_lane_organization',
    'validate_bpmn_lane_organization',
    'convert_bpmn_collaboration_to_lanes',
    'suggest_bpmn_pool_vs_lanes',
    'autosize_bpmn_pools_and_lanes',
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  test("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const schema = getSchema(tool);
      expect(schema.type).toBe('object');
    }
  });

  test('add_bpmn_element requires diagramId and elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementType']));
  });

  test('add_bpmn_element enum includes BoundaryEvent and CallActivity', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:BoundaryEvent');
    expect(enumValues).toContain('bpmn:CallActivity');
    expect(enumValues).toContain('bpmn:TextAnnotation');
  });

  test('export_bpmn requires diagramId, format, and filePath', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'export_bpmn');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'format', 'filePath']));
    expect(schema.properties!.format.enum).toEqual(['xml', 'svg', 'both']);
  });

  test('connect_bpmn_elements has connectionType and conditionExpression params', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.connectionType).toBeDefined();
    expect(schema.properties!.conditionExpression).toBeDefined();
  });

  test('align_bpmn_elements requires diagramId and elementIds', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementIds']));
  });

  test('set_bpmn_input_output_mapping has inputParameters and outputParameters but not source', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_input_output_mapping');
    const schema = getSchema(tool);
    expect(schema.properties!.inputParameters).toBeDefined();
    expect(schema.properties!.outputParameters).toBeDefined();
    // source and sourceExpression should have been removed
    const inputItemProps = schema.properties!.inputParameters.items.properties;
    expect(inputItemProps.source).toBeUndefined();
    expect(inputItemProps.sourceExpression).toBeUndefined();
  });

  test('set_bpmn_event_definition requires eventDefinitionType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_event_definition');
    const schema = getSchema(tool);
    expect(schema.required).toContain('eventDefinitionType');
  });

  test('set_bpmn_form_data requires fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_form_data');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementId', 'fields']));
  });

  test('align_bpmn_elements has compact and distribute parameters', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'align_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.compact).toBeDefined();
    expect(schema.properties!.compact.type).toBe('boolean');
    expect(schema.properties!.orientation).toBeDefined();
    expect(schema.properties!.gap).toBeDefined();
    expect(schema.properties!.gap.type).toBe('number');
  });

  test('connect_bpmn_elements has isDefault parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.isDefault).toBeDefined();
    expect(schema.properties!.isDefault.type).toBe('boolean');
  });

  test('add_bpmn_element enum includes Participant and Lane', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:Participant');
    expect(enumValues).toContain('bpmn:Lane');
  });

  test('layout_bpmn_diagram requires diagramId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.required).toContain('diagramId');
  });

  test('set_bpmn_camunda_listeners has errorDefinitions parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_camunda_listeners');
    const schema = getSchema(tool);
    expect(schema.properties!.errorDefinitions).toBeDefined();
    expect(schema.properties!.errorDefinitions.type).toBe('array');
  });

  test('set_bpmn_loop_characteristics requires loopType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_loop_characteristics');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementId', 'loopType']));
  });
});
