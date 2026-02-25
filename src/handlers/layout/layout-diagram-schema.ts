/**
 * JSON Schema for the layout_bpmn_diagram tool.
 *
 * Extracted from layout-diagram.ts to keep the handler logic under the
 * file-size lint limit.
 */

export const TOOL_DEFINITION = {
  name: 'layout_bpmn_diagram',
  description:
    'Automatically arrange elements in a BPMN diagram using the rebuild-based layout engine, producing a clean left-to-right layout. Handles parallel branches, reconverging gateways, boundary events, subprocesses, pools, lanes, and nested containers. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout. ' +
    'Use dryRun to preview changes before applying them. ' +
    'Use labelsOnly: true to only adjust label positions without moving elements. ' +
    '**When NOT to use full layout:** If the diagram has carefully positioned elements, custom label placements, or boundary events, full re-layout may reposition them destructively. In such cases, prefer: (1) labelsOnly: true for label cleanup only, (2) move_bpmn_element for targeted repositioning, (3) scopeElementId parameter to re-layout only one participant/subprocess.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      scopeElementId: {
        type: 'string',
        description:
          'Optional ID of a Participant or SubProcess to layout in isolation, leaving the rest of the diagram unchanged.',
      },
      gridSnap: {
        type: 'number',
        description:
          'Optional pixel grid snapping. Pass a number (e.g. 10) to snap element positions to a pixel grid after layout. Off by default.',
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true, preview layout changes without applying them. Returns displacement statistics showing how many elements would move and by how much. Default: false.',
      },
      poolExpansion: {
        type: 'boolean',
        description:
          'Automatically resize pools and lanes after layout to fit all elements ' +
          'with proper padding. Prevents elements from overflowing pool/lane boundaries after ' +
          'layout repositioning. Default: auto-enabled when the diagram contains pools.',
      },
      labelsOnly: {
        type: 'boolean',
        description:
          'When true, only adjust labels without performing full layout. ' +
          'Useful for fixing label overlaps after importing diagrams or manual positioning.',
      },
      expandSubprocesses: {
        type: 'boolean',
        description:
          'When true, expand collapsed subprocesses that have internal flow-node ' +
          'children before running layout. Converts drill-down plane subprocesses ' +
          'to inline expanded subprocesses so the layout engine can arrange their ' +
          'children on the main plane. Default: false (preserve existing collapsed/expanded state).',
      },
    },
    required: ['diagramId'],
  },
} as const;
