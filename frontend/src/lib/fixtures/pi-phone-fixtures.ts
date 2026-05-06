import type {
  PhoneCommand,
  PhonePathSuggestion,
  PhoneRawMessage,
  PhoneRpcResponse,
  PhoneSnapshotEnvelope,
  PhoneToolExecutionEndEvent,
  PhoneToolExecutionStartEvent,
  PhoneToolExecutionUpdateEvent,
} from '$lib/types/pi-phone';

export const fixtureMessages: PhoneRawMessage[] = [
  {
    role: 'user',
    timestamp: 1_700_000_000_000,
    content: [
      { type: 'text', text: 'Review these screenshots and run tests: ' },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png', name: 'before.png' },
      { type: 'image', previewUrl: 'blob:after', mimeType: 'image/png', name: 'after.png' },
    ],
  },
  {
    role: 'assistant',
    timestamp: 1_700_000_060_000,
    model: 'gpt-5-codex',
    content: [
      { type: 'thinking', thinking: 'Need inspect state first.\u001b[31m' },
      { type: 'text', text: 'I will inspect the adapters and run a focused fixture test.' },
      { type: 'toolCall', id: 'tool-read-1', name: 'read', arguments: { path: 'frontend/src/lib/stores/pi-phone-state.ts' } },
    ],
    usage: {
      input: 1200,
      output: 340,
      cost: { total: 0.0123 },
    },
    stopReason: 'tool-calls',
    details: { latencyMs: 250, providerRequestId: 'req-fixture-1' },
  },
  {
    role: 'toolResult',
    timestamp: 1_700_000_070_000,
    toolCallId: 'tool-read-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'export function createPiPhoneStateStore() { /* ... */ }' }],
    details: { path: 'frontend/src/lib/stores/pi-phone-state.ts', lineCount: 1053 },
  },
  {
    role: 'bashExecution',
    timestamp: 1_700_000_080_000,
    command: 'npm run frontend:test:fixtures',
    output: '\u001b[32mPASS\u001b[0m fixture tests',
    exitCode: 0,
    truncated: false,
  },
  {
    role: 'custom',
    customType: 'phone-inline-user-message',
    timestamp: 1_700_000_090_000,
    content: 'Follow-up from extension UI',
  },
  {
    role: 'custom',
    customType: 'review-status',
    timestamp: 1_700_000_100_000,
    content: [{ type: 'text', text: 'Fixture review status message' }],
    details: { severity: 'info' },
  },
  {
    role: 'custom',
    customType: 'hidden-debug',
    timestamp: 1_700_000_105_000,
    content: 'This should not be transformed',
    display: false,
  },
  {
    role: 'branchSummary',
    timestamp: 1_700_000_110_000,
    summary: 'Created a SvelteKit state adapter fixture branch.',
    fromId: 'entry-1',
  },
  {
    role: 'compactionSummary',
    timestamp: 1_700_000_120_000,
    summary: 'Kept adapter and reducer context.',
    tokensBefore: 42_000,
  },
];

export const fixtureCommands: PhoneCommand[] = [
  { name: 'new', source: 'local', description: 'Start a fresh Pi session' },
  { name: 'cd', source: 'local', description: 'Change the session cwd', insertOnly: true },
  { name: 'review', source: 'extension', description: 'Ask the review extension for feedback', location: 'extensions/review.ts' },
  { name: 'plan', source: 'prompt', description: 'Insert the project planning prompt', insertOnly: true },
];

export const fixtureSnapshotEnvelope: PhoneSnapshotEnvelope = {
  channel: 'snapshot',
  sessionWorkerId: 'worker-parent',
  state: {
    model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT-5 Codex', contextWindow: 200_000 },
    thinkingLevel: 'medium',
    isStreaming: true,
    isCompacting: false,
    sessionFile: '/tmp/pi-phone-session.jsonl',
    sessionId: 'session-123',
    sessionName: 'Fixture session',
    messageCount: fixtureMessages.length,
    pendingMessageCount: 1,
    contextUsage: { tokens: 64_000, contextWindow: 200_000, percent: 32 },
    commandContextAvailable: true,
  },
  messages: fixtureMessages,
  commands: fixtureCommands,
  liveAssistantMessage: {
    role: 'assistant',
    timestamp: 1_700_000_120_000,
    model: 'gpt-5-codex',
    content: [{ type: 'text', text: 'Streaming answer...' }],
  },
  liveTools: [
    {
      toolCallId: 'tool-bash-live',
      toolName: 'bash',
      args: { command: 'npm test' },
      partialResult: { content: [{ type: 'text', text: 'running root typecheck' }], details: { lineCount: 1 } },
      result: null,
      isError: false,
    },
    {
      toolCallId: 'tool-read-done',
      toolName: 'read',
      args: { path: 'frontend/package.json' },
      partialResult: null,
      result: { content: [{ type: 'text', text: '{ "name": "@malinamnam/pi-phone-frontend-svelte" }' }], details: { path: 'frontend/package.json' } },
      isError: false,
    },
  ],
};

export const fixturePathSuggestions: PhonePathSuggestion[] = [
  { value: 'src/lib/', description: 'frontend/src/lib', isDirectory: true, kind: 'path' },
  { value: 'src/routes/+page.svelte', description: 'route page', isDirectory: false, kind: 'path' },
  { value: 'README.md', description: 'recent README', isDirectory: false, kind: 'previous' },
];

export const fixturePathSuggestionResponse: PhoneRpcResponse<'path_suggestions'> = {
  type: 'response',
  command: 'path_suggestions',
  success: true,
  data: {
    mode: 'mention',
    query: 'src',
    cwd: '/repo/frontend',
    requestId: 7,
    suggestions: fixturePathSuggestions,
  },
};

export const fixtureCommandsResponse: PhoneRpcResponse<'get_commands'> = {
  type: 'response',
  command: 'get_commands',
  success: true,
  data: { commands: fixtureCommands },
};

export const fixtureToolStart: PhoneToolExecutionStartEvent = {
  type: 'tool_execution_start',
  sessionWorkerId: 'worker-parent',
  toolCallId: 'tool-bash-42',
  toolName: 'bash',
  args: { command: 'npm test' },
};

export const fixtureToolUpdate: PhoneToolExecutionUpdateEvent = {
  type: 'tool_execution_update',
  sessionWorkerId: 'worker-parent',
  toolCallId: 'tool-bash-42',
  partialResult: { content: [{ type: 'text', text: 'typecheck running' }], details: { lineCount: 1 } },
};

export const fixtureToolEnd: PhoneToolExecutionEndEvent = {
  type: 'tool_execution_end',
  sessionWorkerId: 'worker-parent',
  toolCallId: 'tool-bash-42',
  toolName: 'bash',
  args: { command: 'npm test' },
  result: { content: [{ type: 'text', text: 'PASS npm test' }], details: { exitCode: 0 } },
  isError: false,
};
