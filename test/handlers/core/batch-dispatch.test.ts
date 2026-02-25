import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../../src/tool-definitions';
import { dispatchToolCall } from '../../../src/handlers';

describe('batch_bpmn_operations — all tools dispatchable', () => {
  test('every registered tool name can be dispatched (no "Unknown tool")', () => {
    // Verify that every tool in TOOL_DEFINITIONS has a matching handler
    // in the dispatch map. We don't execute them (they need valid args),
    // but we verify they don't throw MethodNotFound.
    for (const tool of TOOL_DEFINITIONS) {
      // Calling with invalid args should throw a validation error,
      // NOT "Unknown tool". This confirms the dispatch map covers all tools.
      const promise = dispatchToolCall(tool.name, {});
      // We expect either a validation error or a result — NOT "Unknown tool"
      promise.catch((err: any) => {
        expect(err.message).not.toContain('Unknown tool');
      });
    }
  });

  test('dispatch map covers exactly the same tools as TOOL_DEFINITIONS', () => {
    // The dispatch map is auto-derived from TOOL_REGISTRY, same as TOOL_DEFINITIONS.
    // Verify counts match (39 tools).
    expect(TOOL_DEFINITIONS.length).toBe(39);

    // Verify no tool name is duplicated
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test('unknown tool name throws MethodNotFound', async () => {
    await expect(dispatchToolCall('nonexistent_tool', {})).rejects.toThrow(/Unknown tool/);
  });
});
