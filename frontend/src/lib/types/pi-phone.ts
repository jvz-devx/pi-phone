export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type UnknownRecord = Record<string, unknown>;

export type PhoneSessionKind = 'parent' | 'parallel';
export type PhoneControlOwner = 'cli' | 'phone';
export type PhoneThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | (string & {});
export type PhoneStreamingBehavior = 'steer' | 'followUp';

export type PhoneThemePayload = {
  name: string;
  colors: {
    accent?: string;
    mdCode?: string;
    mdCodeBlock?: string;
    mdCodeBlockBorder?: string;
    [key: string]: string | undefined;
  };
};

export type PhoneHealth = {
  cwd?: string;
  hasToken: boolean;
  isRunning: boolean;
  childRunning?: boolean;
  isStreaming?: boolean;
  isCompacting?: boolean;
  lastError?: string;
  pid?: number;
  childPid?: number | null;
  piCommand?: string;
  connectedClients?: number;
  sessionCount?: number;
  host: string;
  port: number;
  idleTimeoutMs?: number;
  lastActivityAt?: number;
  singleClientMode?: boolean;
  controlOwner?: PhoneControlOwner;
  commandContextAvailable?: boolean;
  theme?: PhoneThemePayload | null;
};

export type PhoneStatus = PhoneHealth & {
  cwd: string;
  childRunning: boolean;
  previousCwd?: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  lastError: string;
  childPid: number | null;
  sessionWorkerId: string | null;
  sessionKind: PhoneSessionKind;
  activeSessionId?: string | null;
};

export type PhoneModel = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number | null;
  [key: string]: unknown;
};

export type PhoneSessionSummary = {
  id: string;
  kind: PhoneSessionKind;
  sessionId: string | null;
  sessionFile: string | null;
  sessionName: string | null;
  label: string;
  secondaryLabel: string;
  firstUserPreview: string | null;
  lastUserPreview: string | null;
  model: Pick<PhoneModel, 'id' | 'name' | 'provider'> | null;
  isRunning: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  messageCount: number;
  pendingMessageCount: number;
  hasPendingUiRequest: boolean;
  lastError: string;
  lastActivityAt: number;
  childPid: number | null;
  cwd?: string | null;
  mirrorsCli?: boolean;
  commandContextAvailable?: boolean;
};

export type PhoneSessionCatalog = {
  activeSessionId: string | null;
  sessions: PhoneSessionSummary[];
};

export type PhoneContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type PhoneSnapshotState = {
  model: PhoneModel | null;
  thinkingLevel?: PhoneThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string | null;
  sessionName?: string | null;
  messageCount: number;
  pendingMessageCount: number;
  contextUsage?: PhoneContextUsage;
  commandContextAvailable?: boolean;
  [key: string]: unknown;
};

export type PhoneImageContent = {
  type: 'image';
  data?: string;
  mimeType?: string;
  url?: string;
  previewUrl?: string;
  name?: string;
  [key: string]: unknown;
};

export type PhoneTextContent = {
  type: 'text';
  text: string;
  [key: string]: unknown;
};

export type PhoneThinkingContent = {
  type: 'thinking';
  thinking: string;
  [key: string]: unknown;
};

export type PhoneToolCallContent = {
  type: 'toolCall';
  id?: string;
  name: string;
  arguments?: UnknownRecord;
  [key: string]: unknown;
};

export type PhoneMessageContentPart =
  | PhoneTextContent
  | PhoneImageContent
  | PhoneThinkingContent
  | PhoneToolCallContent
  | ({ type: string } & UnknownRecord);

export type PhoneMessageContent = string | PhoneMessageContentPart[];

export type PhoneUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type PhoneUserMessage = {
  role: 'user';
  content: PhoneMessageContent;
  timestamp?: number;
  [key: string]: unknown;
};

export type PhoneAssistantMessage = {
  role: 'assistant';
  content: PhoneMessageContentPart[];
  timestamp?: number;
  model?: string;
  usage?: PhoneUsage;
  stopReason?: string;
  [key: string]: unknown;
};

export type PhoneToolResultMessage = {
  role: 'toolResult';
  toolCallId?: string;
  toolName?: string;
  content: PhoneMessageContent;
  timestamp?: number;
  isError?: boolean;
  details?: unknown;
  [key: string]: unknown;
};

export type PhoneBashExecutionMessage = {
  role: 'bashExecution';
  command?: string;
  output?: string;
  timestamp?: number;
  exitCode?: number | null;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  [key: string]: unknown;
};

export type PhoneCustomMessage = {
  role: 'custom';
  customType?: string;
  content: PhoneMessageContent;
  display?: boolean;
  timestamp?: number;
  details?: unknown;
  [key: string]: unknown;
};

export type PhoneBranchSummaryMessage = {
  role: 'branchSummary';
  summary: string;
  fromId?: string;
  timestamp?: number;
  [key: string]: unknown;
};

export type PhoneCompactionSummaryMessage = {
  role: 'compactionSummary';
  summary: string;
  tokensBefore?: number;
  timestamp?: number;
  [key: string]: unknown;
};

export type PhoneRawMessage =
  | PhoneUserMessage
  | PhoneAssistantMessage
  | PhoneToolResultMessage
  | PhoneBashExecutionMessage
  | PhoneCustomMessage
  | PhoneBranchSummaryMessage
  | PhoneCompactionSummaryMessage
  | ({ role: string } & UnknownRecord);

export type PhoneToolResultPayload = {
  content?: PhoneMessageContent;
  details?: unknown;
  [key: string]: unknown;
};

export type PhoneLiveTool = {
  toolCallId: string;
  toolName: string;
  args: UnknownRecord;
  partialResult: PhoneToolResultPayload | null;
  result: PhoneToolResultPayload | null;
  isError: boolean;
};

export type PhoneSnapshotEnvelope = {
  channel: 'snapshot';
  sessionWorkerId?: string | null;
  state: PhoneSnapshotState | null;
  messages: PhoneRawMessage[];
  commands: PhoneCommand[];
  liveAssistantMessage: PhoneRawMessage | null;
  liveTools: PhoneLiveTool[];
};

export type PhoneCommandSource = 'local' | 'extension' | 'prompt' | 'skill' | (string & {});

export type PhoneCommand = {
  name: string;
  description?: string;
  source?: PhoneCommandSource;
  insertOnly?: boolean;
  path?: string;
  location?: string;
  sourceInfo?: {
    path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type PhoneLocalCommandName =
  | 'new'
  | 'compact'
  | 'reload'
  | 'stats'
  | 'cost'
  | 'model'
  | 'thinking'
  | 'commands'
  | 'sessions'
  | 'tree'
  | 'cd'
  | 'refresh';

export type PhoneStats = {
  sessionFile: string | null;
  sessionId: string | null;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
};

export type PhoneSavedSession = {
  path: string;
  id: string;
  cwd: string;
  name?: string | null;
  parentSessionPath?: string | null;
  created: string | number;
  modified: string | number;
  messageCount: number;
  firstMessage?: string;
};

export type PhoneTreeNodeSummary = {
  kind: string;
  preview: string;
  role?: string;
};

export type PhoneTreeNode = {
  id: string;
  parentId?: string | null;
  type: string;
  depth: number;
  timestamp?: string | number;
  label?: string;
  childCount: number;
  summary: PhoneTreeNodeSummary;
};

export type PhoneTree = {
  sessionFile: string;
  currentLeafId: string | null;
  currentPathIds: string[];
  nodes: PhoneTreeNode[];
};

export type PhoneQuotaWindow = {
  label: '5h' | '7d';
  leftPercent: number;
  usedPercent: number;
  resetAfterSeconds: number | null;
  text: string;
};

export type PhoneQuotaResponse = {
  visible: boolean;
  limited: boolean;
  primaryWindow: PhoneQuotaWindow | null;
  secondaryWindow: PhoneQuotaWindow | null;
  error?: string;
};

export type PhonePathSuggestionMode = 'mention' | 'cd';

export type PhonePathSuggestion = {
  value: string;
  label?: string;
  description?: string;
  isDirectory: boolean;
  kind: 'path' | 'previous';
};

export type PhoneRpcCommandType =
  | 'get_state'
  | 'get_messages'
  | 'get_commands'
  | 'get_available_models'
  | 'get_session_stats'
  | 'phone_list_sessions'
  | 'phone_get_tree'
  | 'phone_open_branch_path'
  | 'new_parent_session'
  | 'new_session'
  | 'compact'
  | 'slash_command'
  | 'reload'
  | 'set_model'
  | 'set_thinking_level'
  | 'switch_session'
  | 'fork'
  | 'abort'
  | 'prompt'
  | 'set_session_name'
  | 'cd'
  | 'path_suggestions'
  | 'extension_ui_response'
  | (string & {});

export type PhoneRpcSuccessDataByCommand = {
  get_state: PhoneSnapshotState;
  get_messages: { messages: PhoneRawMessage[] };
  get_commands: { commands: PhoneCommand[] };
  get_available_models: { models: PhoneModel[] };
  get_session_stats: PhoneStats;
  phone_list_sessions: { sessions: PhoneSavedSession[]; cwd: string };
  phone_get_tree: PhoneTree;
  phone_open_branch_path: { path: string; switchResult?: unknown };
  new_parent_session: UnknownRecord | undefined;
  new_session: UnknownRecord | undefined;
  compact: { started?: boolean } | undefined;
  slash_command: { source?: PhoneCommandSource } | undefined;
  reload: { sessionFile?: string | null; commandContextAvailable?: boolean; warning?: string };
  set_model: PhoneModel;
  set_thinking_level: undefined;
  switch_session: UnknownRecord | undefined;
  fork: { cancelled?: boolean } | undefined;
  abort: undefined;
  prompt: undefined;
  set_session_name: undefined;
  cd: { cwd: string; previousCwd?: string | null };
  path_suggestions: {
    mode: PhonePathSuggestionMode;
    query: string;
    cwd: string;
    requestId: number;
    suggestions: PhonePathSuggestion[];
  };
  extension_ui_response: undefined;
};

export type PhoneRpcSuccessResponse<C extends PhoneRpcCommandType = PhoneRpcCommandType> = {
  type: 'response';
  id?: string;
  sessionWorkerId?: string;
  command: C;
  success: true;
  data?: C extends keyof PhoneRpcSuccessDataByCommand ? PhoneRpcSuccessDataByCommand[C] : unknown;
};

export type PhoneRpcErrorResponse<C extends PhoneRpcCommandType = PhoneRpcCommandType> = {
  type: 'response';
  id?: string;
  sessionWorkerId?: string;
  command: C;
  success: false;
  error?: string;
  data?: unknown;
};

export type PhoneRpcResponse<C extends PhoneRpcCommandType = PhoneRpcCommandType> =
  | PhoneRpcSuccessResponse<C>
  | PhoneRpcErrorResponse<C>;

export type PhoneAgentStartEvent = { type: 'agent_start'; sessionWorkerId?: string };
export type PhoneAgentEndEvent = { type: 'agent_end'; sessionWorkerId?: string };
export type PhoneMessageStartEvent = { type: 'message_start'; sessionWorkerId?: string; message: PhoneRawMessage };
export type PhoneMessageUpdateEvent = {
  type: 'message_update';
  sessionWorkerId?: string;
  message?: PhoneRawMessage;
  assistantMessageEvent?: unknown;
};
export type PhoneMessageEndEvent = { type: 'message_end'; sessionWorkerId?: string; message: PhoneRawMessage };

export type PhoneToolExecutionStartEvent = {
  type: 'tool_execution_start';
  sessionWorkerId?: string;
  toolCallId: string;
  toolName: string;
  args: UnknownRecord;
};

export type PhoneToolExecutionUpdateEvent = {
  type: 'tool_execution_update';
  sessionWorkerId?: string;
  toolCallId: string;
  toolName?: string;
  args?: UnknownRecord;
  partialResult?: PhoneToolResultPayload | null;
};

export type PhoneToolExecutionEndEvent = {
  type: 'tool_execution_end';
  sessionWorkerId?: string;
  toolCallId: string;
  toolName?: string;
  args?: UnknownRecord;
  result?: PhoneToolResultPayload | null;
  isError?: boolean;
};

export type PhoneAutoRetryStartEvent = {
  type: 'auto_retry_start';
  sessionWorkerId?: string;
  errorMessage?: string;
};

export type PhoneAutoRetryEndEvent = {
  type: 'auto_retry_end';
  sessionWorkerId?: string;
  success: boolean;
  finalError?: string;
};

export type PhoneExtensionUiMethod =
  | 'notify'
  | 'setStatus'
  | 'setWidget'
  | 'setTitle'
  | 'set_editor_text'
  | 'select'
  | 'confirm'
  | 'input'
  | 'editor';

export type PhoneExtensionUiRequestBase<M extends PhoneExtensionUiMethod = PhoneExtensionUiMethod> = {
  type: 'extension_ui_request';
  method: M;
  id?: string | number;
  sessionWorkerId?: string;
  title?: string;
  message?: string;
};

export type PhoneExtensionNotifyRequest = PhoneExtensionUiRequestBase<'notify'> & {
  message: string;
  level?: 'info' | 'warning' | 'error' | string;
};

export type PhoneExtensionStatusRequest = PhoneExtensionUiRequestBase<'setStatus'> & {
  statusText?: string;
};

export type PhoneExtensionWidgetRequest = PhoneExtensionUiRequestBase<'setWidget'> & {
  widgetKey?: string;
  widgetLines?: string[];
};

export type PhoneExtensionTitleRequest = PhoneExtensionUiRequestBase<'setTitle'> & {
  title?: string;
};

export type PhoneExtensionSetEditorTextRequest = PhoneExtensionUiRequestBase<'set_editor_text'> & {
  text?: string;
};

export type PhoneExtensionSelectRequest = PhoneExtensionUiRequestBase<'select'> & {
  id: string | number;
  options?: string[];
};

export type PhoneExtensionConfirmRequest = PhoneExtensionUiRequestBase<'confirm'> & {
  id: string | number;
};

export type PhoneExtensionInputRequest = PhoneExtensionUiRequestBase<'input' | 'editor'> & {
  id: string | number;
  placeholder?: string;
  prefill?: string;
};

export type PhoneExtensionUiRequest =
  | PhoneExtensionNotifyRequest
  | PhoneExtensionStatusRequest
  | PhoneExtensionWidgetRequest
  | PhoneExtensionTitleRequest
  | PhoneExtensionSetEditorTextRequest
  | PhoneExtensionSelectRequest
  | PhoneExtensionConfirmRequest
  | PhoneExtensionInputRequest
  | (PhoneExtensionUiRequestBase & UnknownRecord);

export type PhoneExtensionUiResponse = {
  type: 'extension_ui_response';
  id: string | number;
  sessionWorkerId?: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
  error?: string;
};

export type PhoneRpcPayload =
  | PhoneRpcResponse
  | PhoneAgentStartEvent
  | PhoneAgentEndEvent
  | PhoneMessageStartEvent
  | PhoneMessageUpdateEvent
  | PhoneMessageEndEvent
  | PhoneToolExecutionStartEvent
  | PhoneToolExecutionUpdateEvent
  | PhoneToolExecutionEndEvent
  | PhoneAutoRetryStartEvent
  | PhoneAutoRetryEndEvent
  | PhoneExtensionUiRequest;

export type PhoneServerEventName =
  | 'status'
  | 'stderr'
  | 'reloading'
  | 'session-spawned'
  | 'single-client-replaced'
  | 'command-controls-unavailable'
  | 'idle-timeout'
  | 'startup-error'
  | 'snapshot-error'
  | 'client-error'
  | 'agent-exit'
  | 'parse-error'
  | (string & {});

export type PhoneServerEnvelope = {
  channel: 'server';
  event: PhoneServerEventName;
  data?: PhoneStatus | { message?: string; text?: string; line?: string; error?: string; [key: string]: unknown };
};

export type PhoneSessionsCatalogEnvelope = {
  channel: 'sessions';
  event: 'catalog';
  data: PhoneSessionCatalog;
};

export type PhoneRpcEnvelope = {
  channel: 'rpc';
  payload: PhoneRpcPayload;
};

export type PhoneEnvelope = PhoneServerEnvelope | PhoneSessionsCatalogEnvelope | PhoneSnapshotEnvelope | PhoneRpcEnvelope;

export type PhonePromptCommand = {
  type: 'prompt';
  message: string;
  images?: PhoneImageContent[];
  streamingBehavior?: PhoneStreamingBehavior;
};

export type PhoneClientRpcCommand =
  | PhonePromptCommand
  | { type: 'abort' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'fork'; entryId: string }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: PhoneThinkingLevel }
  | { type: 'set_session_name'; name: string }
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'get_commands' }
  | { type: 'get_available_models' }
  | { type: 'get_session_stats' }
  | { type: 'phone_list_sessions'; id?: string }
  | { type: 'phone_get_tree'; id?: string }
  | { type: 'phone_open_branch_path'; entryId: string; id?: string }
  | PhoneExtensionUiResponse
  | ({ type: string } & UnknownRecord);

export type PhoneLocalCommand =
  | 'reload'
  | { type: 'path-suggestions'; mode: PhonePathSuggestionMode; query: string; requestId: number }
  | { type: 'cd'; args: string }
  | { type: 'slash-command'; text: string; images?: PhoneImageContent[]; streamingBehavior?: PhoneStreamingBehavior };

export type PhoneClientMessage =
  | { kind: 'refresh' }
  | { kind: 'session-select'; sessionId: string }
  | { kind: 'session-parent-new' }
  | { kind: 'session-spawn' }
  | { kind: 'local-command'; command: PhoneLocalCommand }
  | { kind: 'rpc'; command: PhoneClientRpcCommand };

export type PhoneToolStatus = 'running' | 'done' | 'error' | 'cancelled';

export type PhoneUiMessageBase = {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'custom' | 'summary' | 'system';
  title?: string;
  meta?: string;
  text?: string;
  details?: unknown;
  live?: boolean;
};

export type PhoneUiUserMessage = PhoneUiMessageBase & {
  kind: 'user';
  rawContent?: PhoneMessageContent;
  imageCount?: number;
};

export type PhoneUiAssistantMessage = PhoneUiMessageBase & {
  kind: 'assistant';
  thinking?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: UnknownRecord }>;
  usage?: PhoneUsage;
  stopReason?: string;
};

export type PhoneUiToolMessage = PhoneUiMessageBase & {
  kind: 'tool';
  toolCallId?: string;
  toolName?: string;
  args?: UnknownRecord;
  command?: string;
  status: PhoneToolStatus;
  rawContent?: PhoneMessageContent | null;
};

export type PhoneUiCustomMessage = PhoneUiMessageBase & {
  kind: 'custom' | 'summary' | 'system';
  customType?: string;
  summaryKind?: 'branch' | 'compaction';
  rawContent?: PhoneMessageContent;
  imageCount?: number;
  fromId?: unknown;
  tokensBefore?: number;
};

export type PhoneUiMessage = PhoneUiUserMessage | PhoneUiAssistantMessage | PhoneUiToolMessage | PhoneUiCustomMessage;

export type PhoneDiffLine = {
  kind: 'added' | 'removed' | 'context' | 'meta';
  prefix: string;
  lineNumber: string;
  text: string;
};

export type PhoneToolPreviewKind = 'bash' | 'read' | 'edit' | 'write' | 'grep' | 'find' | 'ls' | 'markdown' | 'image' | 'terminal' | 'generic';

export type PhoneToolPreview = {
  kind: PhoneToolPreviewKind;
  path?: string;
  command?: string;
  languageLabel?: string;
  lineCount?: number;
  byteCount?: number;
  diffStats?: { added: number; removed: number };
  truncatedNotice?: string;
  content?: string;
  rawContent?: PhoneMessageContent | null;
  defaultOpen?: boolean;
};

export type PhoneAttachmentRecord = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  url: string;
  token: string;
  tokenOrder: number;
};

export type PhoneAutocompleteContext =
  | { type: 'path'; mode: PhonePathSuggestionMode; query: string; replaceStart: number; replaceEnd: number }
  | { type: 'slash-command'; query: string };

export type PhoneAutocompleteItem = {
  kind: 'path' | 'local-command-run' | 'local-command-insert' | 'remote-command-insert';
  label: string;
  badge?: string;
  description?: string;
  title?: string;
  value?: string;
  name?: string;
  isDirectory?: boolean;
};

export type PhoneSheetMode = 'actions' | 'commands' | 'models' | 'thinking' | 'sessions' | 'active-sessions' | 'tree';
