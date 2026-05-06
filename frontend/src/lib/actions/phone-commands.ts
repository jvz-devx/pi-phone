import { contentToText } from '$lib/adapters/message-adapter';
import { phoneClient, type PiPhoneLocalCommand, type PiPhoneRpcCommand, type PhoneClient } from '$lib/pi-phone-transport';
import { piPhoneState, type PhoneAppState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
import type {
  PhoneCommand,
  PhoneCommandSource,
  PhoneImageContent,
  PhoneLocalCommandName,
  PhoneModel,
  PhoneSheetMode,
  PhoneStreamingBehavior,
  PhoneThinkingLevel,
  PhoneUiMessage,
} from '$lib/types/pi-phone';
import {
  buildInlineDisplayContent,
  buildPromptPayload,
  clearAttachmentRecords,
  syncAttachmentsWithPrompt,
} from './attachments';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export const COMMAND_CATEGORY_ORDER = ['local', 'extension', 'prompt', 'skill'];

export type LocalCommandDefinition = {
  name: PhoneLocalCommandName;
  description: string;
  insertOnly?: boolean;
};

export const LOCAL_COMMAND_DEFINITIONS: LocalCommandDefinition[] = [
  { name: 'new', description: 'Start a new session' },
  { name: 'compact', description: 'Compact the current session' },
  { name: 'reload', description: 'Reload extensions, skills, prompts, and themes' },
  { name: 'stats', description: 'Show session stats' },
  { name: 'cost', description: 'Show session cost stats' },
  { name: 'model', description: 'Open model picker' },
  { name: 'thinking', description: 'Open thinking level picker' },
  { name: 'commands', description: 'Browse commands, skills, and prompts' },
  { name: 'sessions', description: 'Browse saved sessions' },
  { name: 'tree', description: 'Browse the current session tree' },
  { name: 'cd', description: 'Change Pi working directory', insertOnly: true },
  { name: 'refresh', description: 'Refresh snapshot' },
];

export const LOCAL_COMMAND_NAMES = new Set<string>(LOCAL_COMMAND_DEFINITIONS.map((command) => command.name));

export type PhoneCommandActionClient = Pick<PhoneClient, 'sendRpc' | 'sendLocalCommand' | 'requestReload' | 'refreshAll' | 'refreshQuota'>;
export type PhoneSessionActionClient = PhoneCommandActionClient & Pick<PhoneClient, 'sendSessionSelect' | 'sendParentSessionNew' | 'sendSessionSpawn'>;
export type CommandDispatchResult = 'handled' | 'blocked' | false;
export type PhoneQuickAction =
  | 'refresh'
  | 'new-session'
  | 'compact'
  | 'stats'
  | 'models'
  | 'thinking'
  | 'commands'
  | 'sessions'
  | 'active-sessions'
  | 'tree';
export type PromptSubmitStatus = 'empty' | 'handled' | 'blocked' | 'sent';

export type PromptSubmitResult = {
  status: PromptSubmitStatus;
  command?: string;
  remoteSource?: PhoneCommandSource;
};

export type ParsedLocalCommand = {
  name: string;
  args: string;
};

export type ParsedSlashCommand = {
  text: string;
  name: string;
};

export type RemoteSlashCommand = ParsedSlashCommand & {
  source: PhoneCommandSource;
};

export function parseLocalCommandInput(text: string): ParsedLocalCommand | null {
  const match = String(text || '').match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1] || '', args: match[2] || '' };
}

export function parseSlashCommandText(text: string): ParsedSlashCommand | null {
  const value = String(text || '').trim();
  if (!value.startsWith('/')) return null;

  const body = value.slice(1).trim();
  if (!body) return null;

  const spaceIndex = body.indexOf(' ');
  const name = spaceIndex === -1 ? body : body.slice(0, spaceIndex);
  return { text: `/${body}`, name };
}

export function findLocalCommandDefinition(name: string) {
  return LOCAL_COMMAND_DEFINITIONS.find((command) => command.name === name) || null;
}

export function localCommandCatalog(): PhoneCommand[] {
  return LOCAL_COMMAND_DEFINITIONS.map((command) => ({
    name: command.name,
    description: command.description,
    source: 'local',
    insertOnly: Boolean(command.insertOnly),
  }));
}

function compareCommandNames(left: PhoneCommand, right: PhoneCommand) {
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

export function sortCommandCategories(categories: string[] = []) {
  return [...categories].sort((left, right) => {
    const leftIndex = COMMAND_CATEGORY_ORDER.indexOf(left);
    const rightIndex = COMMAND_CATEGORY_ORDER.indexOf(right);
    const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) return normalizedLeftIndex - normalizedRightIndex;
    return String(left || '').localeCompare(String(right || ''));
  });
}

export function commandCategoryLabel(category = '') {
  if (!category) return 'Commands';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function visibleCommandCatalog(commands: PhoneCommand[] = piPhoneState.snapshot().commands.available) {
  const localCommands = localCommandCatalog();
  const localNames = new Set(localCommands.map((command) => command.name));
  return [...localCommands, ...commands.filter((command) => !localNames.has(command.name))];
}

export function groupedCommands(commands: PhoneCommand[] = piPhoneState.snapshot().commands.available) {
  const groups = new Map<string, PhoneCommand[]>();

  for (const command of visibleCommandCatalog(commands)) {
    const category = command.source || 'command';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)?.push(command);
  }

  for (const group of groups.values()) group.sort(compareCommandNames);
  return new Map(sortCommandCategories([...groups.keys()]).map((category) => [category, groups.get(category) || []]));
}

export function findRemoteSlashCommand(text: string, commands: PhoneCommand[] = piPhoneState.snapshot().commands.available): RemoteSlashCommand | null {
  const parsed = parseSlashCommandText(text);
  if (!parsed) return null;

  const match = commands.find((command) => command.name === parsed.name);
  if (!match) return null;
  return { ...parsed, source: match.source || 'extension' };
}

export function shouldBlockUnresolvedSlashCommand(text: string, state: PhoneAppState = piPhoneState.snapshot()) {
  const parsed = parseSlashCommandText(text);
  if (!parsed) return false;
  if (LOCAL_COMMAND_NAMES.has(parsed.name)) return false;
  if (state.commands.available.length > 0) return false;
  return !state.commands.loaded;
}

export function blockUnresolvedSlashCommand(
  text: string,
  options: {
    store?: PhoneStateStore;
    client?: PhoneCommandActionClient;
  } = {},
): CommandDispatchResult {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  if (!shouldBlockUnresolvedSlashCommand(text, store.snapshot())) return false;

  const parsed = parseSlashCommandText(text);
  client.sendRpc({ type: 'get_commands' });
  notify(store, `Slash commands are still loading. Refreshing commands; try ${parsed?.text || 'that command'} again in a moment.`, 'warning');
  return 'blocked';
}

export function isStreamingState(state: Pick<PhoneAppState, 'status' | 'snapshot'>) {
  return Boolean(state.status?.isStreaming || state.snapshot.state?.isStreaming);
}

export function canSteer(state: PhoneAppState) {
  return isStreamingState(state) && !state.composer.isSubmitting;
}

export function streamingBehaviorForSubmit(state: PhoneAppState, steer = false): PhoneStreamingBehavior | undefined {
  if (steer) return 'steer';
  return isStreamingState(state) ? 'followUp' : undefined;
}

export function openPhoneSheet(
  mode: PhoneSheetMode,
  options: { store?: PhoneStateStore; client?: PhoneCommandActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  store.setSheetMode(mode, { open: true });

  if (mode === 'actions') client.sendRpc({ type: 'get_session_stats' });
  if (mode === 'models') client.sendRpc({ type: 'get_available_models' });
  if (mode === 'commands') client.sendRpc({ type: 'get_commands' });
  if (mode === 'sessions') client.sendRpc({ type: 'phone_list_sessions' });
  if (mode === 'tree') client.sendRpc({ type: 'phone_get_tree' });
}

function openSheet(store: PhoneStateStore, mode: PhoneAppState['sheets']['mode'], client?: PhoneCommandActionClient) {
  openPhoneSheet(mode, { store, client });
}

function notify(store: PhoneStateStore, text: string, kind: 'info' | 'error' | 'warning' | 'success' = 'info') {
  store.pushToast(text, kind);
}

function markForcedQuotaRefresh(store: PhoneStateStore) {
  store.update((state) => {
    state.quota.refreshNeeded = true;
    state.quota.forceRefresh = true;
    state.connection.forceQuotaRefreshRequested = true;
    return state;
  });
}

function markRefreshRequested(store: PhoneStateStore, forceQuota = false) {
  store.update((state) => {
    state.connection.refreshRequested = true;
    state.connection.refreshRequestId += 1;
    state.connection.forceQuotaRefreshRequested = state.connection.forceQuotaRefreshRequested || forceQuota;
    state.quota.refreshNeeded = true;
    state.quota.forceRefresh = state.quota.forceRefresh || forceQuota;
    return state;
  });
}

function clearSubmittedPrompt(store: PhoneStateStore) {
  store.setComposerText('');
  store.clearAutocomplete();
  clearAttachmentRecords({ store });
}

function appendLocalUserMessage(store: PhoneStateStore, rawPrompt: string, message: string, images: PhoneImageContent[]) {
  const localMessage: PhoneUiMessage = {
    id: `local-user-${Date.now()}`,
    kind: 'user',
    meta: 'just now',
    text: message || '(image prompt)',
    rawContent: buildInlineDisplayContent(rawPrompt, images),
    imageCount: images.length,
  };

  store.appendMessages([localMessage]);
  store.setFollowLatest(true);
}

function modelLabel(model: PhoneModel) {
  return [model.provider, model.id, model.name].filter(Boolean).join('/');
}

export function requestThinkingLevelSwitch(
  level: PhoneThinkingLevel,
  options: {
    store?: PhoneStateStore;
    client?: Pick<PhoneClient, 'sendRpc'>;
  } = {},
): CommandDispatchResult {
  if (!(THINKING_LEVELS as readonly string[]).includes(level)) return false;

  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const sent = client.sendRpc({ type: 'set_thinking_level', level });
  if (!sent) return 'blocked';

  store.setSheetOpen(false);
  return 'handled';
}

export function requestModelSwitch(
  model: PhoneModel | null | undefined,
  options: {
    store?: PhoneStateStore;
    client?: Pick<PhoneClient, 'sendRpc'>;
  } = {},
): CommandDispatchResult {
  if (!model?.provider || !model?.id) return false;

  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const sent = client.sendRpc({ type: 'set_model', provider: model.provider, modelId: model.id });
  if (!sent) return 'blocked';

  markForcedQuotaRefresh(store);
  store.setSheetOpen(false);
  return 'handled';
}

export function tryHandleLocalCommand(
  text: string,
  options: {
    store?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    hasAttachments?: boolean;
  } = {},
): CommandDispatchResult {
  if (!String(text || '').startsWith('/')) return false;

  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const parsed = parseLocalCommandInput(text);
  if (!parsed?.name) return false;

  const { name, args } = parsed;
  if (!LOCAL_COMMAND_NAMES.has(name)) return false;

  if (options.hasAttachments) {
    notify(store, 'Local phone commands do not support image attachments.', 'error');
    return 'blocked';
  }

  if (name === 'new') return client.sendRpc({ type: 'new_session' }) ? 'handled' : 'blocked';
  if (name === 'compact') return client.sendRpc({ type: 'compact' }) ? 'handled' : 'blocked';
  if (name === 'reload') return client.requestReload(store.snapshot()) ? 'handled' : 'blocked';
  if (name === 'refresh') {
    client.refreshAll();
    store.update((state) => {
      state.connection.refreshRequested = true;
      state.connection.refreshRequestId += 1;
      state.quota.refreshNeeded = true;
      return state;
    });
    return 'handled';
  }
  if (name === 'stats' || name === 'cost') {
    openSheet(store, 'actions', client);
    return client.sendRpc({ type: 'get_session_stats' }) ? 'handled' : 'blocked';
  }
  if (name === 'commands') {
    openSheet(store, 'commands', client);
    return 'handled';
  }
  if (name === 'sessions') {
    openSheet(store, 'sessions', client);
    return 'handled';
  }
  if (name === 'tree') {
    openSheet(store, 'tree', client);
    return 'handled';
  }
  if (name === 'cd') return client.sendLocalCommand({ type: 'cd', args }) ? 'handled' : 'blocked';
  if (name === 'thinking') {
    if (args && (THINKING_LEVELS as readonly string[]).includes(args)) {
      return requestThinkingLevelSwitch(args as PhoneThinkingLevel, { store, client });
    }
    openSheet(store, 'thinking', client);
    return 'handled';
  }
  if (name === 'model') {
    if (args) {
      const [provider, modelId] = args.includes('/') ? args.split('/', 2) : [null, args];
      const match = store.snapshot().models.available.find((model) =>
        provider ? model.provider === provider && model.id === modelId : model.id === modelId || model.name === modelId || modelLabel(model) === args,
      );
      if (match) return requestModelSwitch(match, { store, client });
      openSheet(store, 'models', client);
      client.sendRpc({ type: 'get_available_models' });
      notify(store, 'Model not found locally. Pick one from the sheet.', 'error');
    } else {
      openSheet(store, 'models', client);
      client.sendRpc({ type: 'get_available_models' });
    }
    return 'handled';
  }

  return false;
}

export function sendRemoteSlashCommand(
  command: RemoteSlashCommand,
  options: {
    store?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    images?: PhoneImageContent[];
    steer?: boolean;
  } = {},
): CommandDispatchResult {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const images = options.images || [];

  if (command.source === 'extension' && images.length > 0) {
    notify(store, 'Extension slash commands do not support image attachments.', 'error');
    return 'blocked';
  }

  const snapshot = store.snapshot();
  const behavior = command.source !== 'extension' ? streamingBehaviorForSubmit(snapshot, Boolean(options.steer)) : undefined;
  const localCommand: PiPhoneLocalCommand = {
    type: 'slash-command',
    text: command.text,
    ...(images.length ? { images } : {}),
    ...(behavior ? { streamingBehavior: behavior } : {}),
  };

  const sent = client.sendLocalCommand(localCommand);
  if (!sent) return 'blocked';

  if (command.source === 'extension') markForcedQuotaRefresh(store);
  return 'handled';
}

export async function submitPrompt(
  options: {
    store?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    steer?: boolean;
  } = {},
): Promise<PromptSubmitResult> {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const steer = Boolean(options.steer);

  store.updateComposer({ isSubmitting: true });
  try {
    const rawPrompt = store.snapshot().composer.text;
    syncAttachmentsWithPrompt(rawPrompt, { store });

    const snapshot = store.snapshot();
    const commandText = rawPrompt.trim();
    if (!commandText && snapshot.attachments.items.length === 0) return { status: 'empty' };

    const localCommandResult = !steer && commandText
      ? tryHandleLocalCommand(commandText, { store, client, hasAttachments: snapshot.attachments.items.length > 0 })
      : false;

    if (localCommandResult) {
      if (localCommandResult === 'handled') clearSubmittedPrompt(store);
      return { status: localCommandResult, command: commandText };
    }

    let promptPayload: Awaited<ReturnType<typeof buildPromptPayload>>;
    try {
      promptPayload = await buildPromptPayload(rawPrompt, { store });
    } catch (error) {
      notify(store, error instanceof Error ? error.message : 'Failed to read images', 'error');
      return { status: 'blocked' };
    }

    const message = promptPayload.message.trim();
    const images = promptPayload.images;
    const remoteSlashCommand = message ? findRemoteSlashCommand(message, store.snapshot().commands.available) : null;
    if (remoteSlashCommand) {
      const remoteCommandResult = sendRemoteSlashCommand(remoteSlashCommand, { store, client, images, steer });
      if (remoteCommandResult) {
        if (remoteCommandResult === 'handled') clearSubmittedPrompt(store);
        return { status: remoteCommandResult, command: remoteSlashCommand.text, remoteSource: remoteSlashCommand.source };
      }
    }

    const unresolvedSlashCommandResult = message ? blockUnresolvedSlashCommand(message, { store, client }) : false;
    if (unresolvedSlashCommandResult) return { status: unresolvedSlashCommandResult, command: message };

    const behavior = streamingBehaviorForSubmit(store.snapshot(), steer);
    const rpcCommand: PiPhoneRpcCommand = {
      type: 'prompt',
      message,
      ...(behavior ? { streamingBehavior: behavior } : {}),
      ...(images.length ? { images } : {}),
    };

    const sent = client.sendRpc(rpcCommand);
    if (!sent) return { status: 'blocked' };

    appendLocalUserMessage(store, rawPrompt, message, images);
    clearSubmittedPrompt(store);
    return { status: 'sent' };
  } finally {
    store.updateComposer({ isSubmitting: false, steerAvailable: canSteer(store.snapshot()) });
  }
}

export function abortGeneration(options: { client?: PhoneCommandActionClient; store?: PhoneStateStore } = {}) {
  const client = options.client || phoneClient;
  const store = options.store || piPhoneState;
  const sent = client.sendRpc({ type: 'abort' });
  if (sent) store.updateComposer({ steerAvailable: false });
  return sent;
}

export function handleInsertOnlyLocalCommand(
  commandName: string,
  options: { text?: string; cursor?: number } = {},
) {
  const definition = findLocalCommandDefinition(commandName);
  if (!definition?.insertOnly) return null;

  const value = options.text || '';
  if (commandName === 'cd') {
    if (!value.trim()) return { text: '/cd ', cursor: 4 };
    const cursor = Math.max(0, Math.min(value.length, options.cursor ?? value.length));
    const insertion = '/cd ';
    return { text: `${value.slice(0, cursor)}${insertion}${value.slice(cursor)}`, cursor: cursor + insertion.length };
  }

  return { text: `/${commandName} `, cursor: commandName.length + 2 };
}

export function parentCommandControlsAvailable(state: PhoneAppState = piPhoneState.snapshot()) {
  const activeParentUnavailable = state.sessions.active.some((session) => session.kind === 'parent' && session.commandContextAvailable === false);
  const selectedParentUnavailable = state.status?.sessionKind === 'parent' && state.status?.commandContextAvailable === false;
  return !(activeParentUnavailable || selectedParentUnavailable);
}

export function selectActiveSession(
  sessionId: string,
  options: { store?: PhoneStateStore; client?: PhoneSessionActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  if (!sessionId) return false;

  const sent = client.sendSessionSelect(sessionId);
  if (!sent) return false;

  store.clearPendingUiRequest();
  store.clearSnapshotView();
  store.setFollowLatest(true);
  return true;
}

export function startNewParentSession(options: { store?: PhoneStateStore; client?: PhoneSessionActionClient } = {}) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;

  if (!parentCommandControlsAvailable(store.snapshot())) {
    notify(store, 'New Parent is unavailable until Pi provides a fresh command context.', 'error');
    client.refreshAll();
    markRefreshRequested(store);
    return false;
  }

  const sent = client.sendParentSessionNew();
  if (!sent) return false;

  store.clearPendingUiRequest();
  store.clearSnapshotView();
  store.setFollowLatest(true);
  notify(store, 'Starting new parent session…');
  return true;
}

export function spawnParallelSession(options: { store?: PhoneStateStore; client?: PhoneSessionActionClient } = {}) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const sent = client.sendSessionSpawn();
  if (!sent) return false;

  store.clearPendingUiRequest();
  store.clearSnapshotView();
  store.setFollowLatest(true);
  notify(store, 'Opening new parallel session…');
  return true;
}

export function switchSavedSession(
  sessionPath: string,
  options: { store?: PhoneStateStore; client?: PhoneCommandActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const cleanPath = String(sessionPath || '').trim();
  if (!cleanPath) return false;

  const sent = client.sendRpc({ type: 'switch_session', sessionPath: cleanPath });
  if (!sent) return false;

  store.clearPendingUiRequest();
  store.clearSnapshotView();
  store.setFollowLatest(true);
  notify(store, 'Switching saved session…');
  return true;
}

export function forkSessionEntry(
  entryId: string,
  options: { store?: PhoneStateStore; client?: PhoneCommandActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const cleanEntryId = String(entryId || '').trim();
  if (!cleanEntryId) return false;

  const sent = client.sendRpc({ type: 'fork', entryId: cleanEntryId });
  if (!sent) return false;

  notify(store, 'Forking selected session point…');
  markRefreshRequested(store, true);
  return true;
}

export function openBranchPath(
  entryId: string,
  options: { store?: PhoneStateStore; client?: PhoneCommandActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const cleanEntryId = String(entryId || '').trim();
  if (!cleanEntryId) return false;

  const sent = client.sendRpc({ type: 'phone_open_branch_path', entryId: cleanEntryId });
  if (!sent) return false;

  store.clearPendingUiRequest();
  store.clearSnapshotView();
  store.setFollowLatest(true);
  notify(store, 'Opening branch path…');
  return true;
}

export function refreshSavedSessions(options: { client?: PhoneCommandActionClient } = {}) {
  return (options.client || phoneClient).sendRpc({ type: 'phone_list_sessions' });
}

export function refreshSessionTree(options: { client?: PhoneCommandActionClient } = {}) {
  return (options.client || phoneClient).sendRpc({ type: 'phone_get_tree' });
}

export function runPhoneQuickAction(
  action: PhoneQuickAction,
  options: { store?: PhoneStateStore; client?: PhoneSessionActionClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;

  if (action === 'refresh') {
    client.refreshAll();
    markRefreshRequested(store);
    return true;
  }
  if (action === 'new-session') return client.sendRpc({ type: 'new_session' });
  if (action === 'compact') return client.sendRpc({ type: 'compact' });
  if (action === 'stats') {
    openPhoneSheet('actions', { store, client });
    return true;
  }
  if (['models', 'thinking', 'commands', 'sessions', 'active-sessions', 'tree'].includes(action)) {
    openPhoneSheet(action as PhoneSheetMode, { store, client });
    return true;
  }

  return false;
}

export function textFromPromptMessage(message: unknown) {
  if (!message || typeof message !== 'object') return '';
  const text = (message as { text?: unknown }).text;
  if (typeof text === 'string') return text;
  return contentToText((message as { content?: never }).content);
}
