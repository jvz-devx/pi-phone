import { phoneClient, type PhoneClient } from '$lib/pi-phone-transport';
import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
import type { PhoneAutocompleteContext, PhoneAutocompleteItem, PhoneCommand } from '$lib/types/pi-phone';
import { tryHandleLocalCommand, visibleCommandCatalog, type PhoneCommandActionClient } from './phone-commands';

export const AUTOCOMPLETE_DELIMITERS = new Set([' ', '\t', '\n', '"', "'", '=']);
export const PATH_SUGGESTION_DEBOUNCE_MS = 90;

export type PhoneAutocompleteClient = Pick<PhoneClient, 'sendLocalCommand'>;

export type AutocompleteDetection = PhoneAutocompleteContext | null;

export type ApplyAutocompleteResult = {
  handled: boolean;
  text: string;
  cursor: number;
  commandResult?: 'handled' | 'blocked' | false;
};

function delimiterBeforeIndex(text: string, index: number) {
  return index <= 0 || AUTOCOMPLETE_DELIMITERS.has(text[index - 1]);
}

function findTokenBounds(text: string, start: number, end: number) {
  let tokenStart = start;
  let tokenEnd = end;

  while (tokenStart > 0 && !AUTOCOMPLETE_DELIMITERS.has(text[tokenStart - 1])) tokenStart -= 1;
  while (tokenEnd < text.length && !AUTOCOMPLETE_DELIMITERS.has(text[tokenEnd])) tokenEnd += 1;

  return { start: tokenStart, end: tokenEnd };
}

export function detectMentionAutocompleteContext(text: string, cursor: number): AutocompleteDetection {
  const value = String(text || '');
  const scanLimit = Math.max(0, Math.min(cursor, value.length));
  let tokenStart = scanLimit;
  while (tokenStart > 0 && !AUTOCOMPLETE_DELIMITERS.has(value[tokenStart - 1])) tokenStart -= 1;

  if (value[tokenStart] !== '@') return null;
  if (!delimiterBeforeIndex(value, tokenStart)) return null;

  const bounds = findTokenBounds(value, tokenStart, scanLimit);
  return {
    type: 'path',
    mode: 'mention',
    query: value.slice(tokenStart + 1, scanLimit),
    replaceStart: bounds.start,
    replaceEnd: bounds.end,
  };
}

export function detectCdAutocompleteContext(text: string, cursor: number): AutocompleteDetection {
  const value = String(text || '');
  const leadingWhitespace = value.match(/^\s*/)?.[0] || '';
  const trimmed = value.slice(leadingWhitespace.length);
  if (!trimmed.startsWith('/cd')) return null;

  const afterCommand = trimmed.slice(3);
  if (afterCommand && !/^\s/.test(afterCommand)) return null;

  const commandStart = leadingWhitespace.length;
  const argsStart = commandStart + 3 + (afterCommand.match(/^\s*/) || [''])[0].length;
  if (cursor < argsStart) return null;

  return {
    type: 'path',
    mode: 'cd',
    query: value.slice(argsStart, Math.max(0, Math.min(cursor, value.length))),
    replaceStart: argsStart,
    replaceEnd: value.length,
  };
}

export function detectSlashCommandAutocompleteContext(text: string, cursor: number): AutocompleteDetection {
  const value = String(text || '');
  const clampedCursor = Math.max(0, Math.min(cursor, value.length));
  const leadingWhitespace = value.match(/^\s*/)?.[0] || '';
  const trimmedBeforeCursor = value.slice(leadingWhitespace.length, clampedCursor);
  if (!trimmedBeforeCursor.startsWith('/')) return null;
  if (/\s/.test(trimmedBeforeCursor.slice(1))) return null;

  return {
    type: 'slash-command',
    query: trimmedBeforeCursor.slice(1),
  };
}

export function activeAutocompleteContext(text: string, cursor: number): AutocompleteDetection {
  return (
    detectMentionAutocompleteContext(text, cursor) ||
    detectCdAutocompleteContext(text, cursor) ||
    detectSlashCommandAutocompleteContext(text, cursor)
  );
}

export function slashCommandItems(query: string, commands: PhoneCommand[]) {
  const lowerQuery = String(query || '').toLowerCase();
  return visibleCommandCatalog(commands)
    .filter((command) => command.name.toLowerCase().startsWith(lowerQuery))
    .slice(0, 10)
    .map((command): PhoneAutocompleteItem => ({
      kind: command.source === 'local' ? (command.insertOnly ? 'local-command-insert' : 'local-command-run') : 'remote-command-insert',
      label: `/${command.name}`,
      badge: command.source || 'command',
      description: command.description || '',
      name: command.name,
      title: command.description || '',
    }));
}

export function requestPathSuggestions(
  context: PhoneAutocompleteContext,
  options: { store?: PhoneStateStore; client?: PhoneAutocompleteClient } = {},
) {
  if (context.type !== 'path') return false;
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const requestId = store.beginAutocompleteRequest();
  return client.sendLocalCommand({
    type: 'path-suggestions',
    mode: context.mode,
    query: context.query,
    requestId,
  });
}

export function queuePathSuggestions(
  context: PhoneAutocompleteContext,
  options: { store?: PhoneStateStore; client?: PhoneAutocompleteClient; debounceMs?: number } = {},
) {
  const store = options.store || piPhoneState;
  if (context.type !== 'path') return null;

  const timer = setTimeout(() => {
    store.clearAutocompleteTimer();
    requestPathSuggestions(context, options);
  }, options.debounceMs ?? PATH_SUGGESTION_DEBOUNCE_MS);
  store.setAutocompleteTimer(timer);
  return timer;
}

export function updateAutocomplete(
  text: string,
  cursor: number,
  options: {
    store?: PhoneStateStore;
    client?: PhoneAutocompleteClient;
    scheduleRemote?: boolean;
  } = {},
) {
  const store = options.store || piPhoneState;
  const context = activeAutocompleteContext(text, cursor);
  store.setAutocompleteContext(context);

  if (!context) {
    store.clearAutocomplete();
    return context;
  }

  if (context.type === 'slash-command') {
    store.clearAutocompleteTimer();
    store.setAutocompleteItems(slashCommandItems(context.query, store.snapshot().commands.available));
    return context;
  }

  store.setAutocompleteItems([]);
  if (options.scheduleRemote ?? true) queuePathSuggestions(context, options);
  return context;
}

export function replacePromptRange(text: string, start: number, end: number, nextText: string) {
  const value = String(text || '');
  const clampedStart = Math.max(0, Math.min(value.length, start));
  const clampedEnd = Math.max(clampedStart, Math.min(value.length, end));
  const nextValue = `${value.slice(0, clampedStart)}${nextText}${value.slice(clampedEnd)}`;
  const cursor = clampedStart + nextText.length;
  return { text: nextValue, cursor };
}

export function insertTextAtCursor(text: string, cursor: number, insertion: string, end = cursor) {
  return replacePromptRange(text, cursor, end, insertion);
}

export function insertSlashCommandText(commandName: string) {
  return { text: `/${commandName} `, cursor: commandName.length + 2 };
}

export function insertCdCommandText(text: string, cursor = String(text || '').length) {
  const value = String(text || '');
  if (!value.trim()) return { text: '/cd ', cursor: 4 };
  return insertTextAtCursor(value, cursor, '/cd ');
}

export function applyAutocompleteItem(
  item: PhoneAutocompleteItem,
  options: {
    text: string;
    cursor?: number;
    context?: PhoneAutocompleteContext | null;
    store?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    hasAttachments?: boolean;
  },
): ApplyAutocompleteResult {
  const store = options.store || piPhoneState;
  const value = String(options.text || '');

  if (!item) return { handled: false, text: value, cursor: options.cursor ?? value.length };

  if (item.kind === 'local-command-run') {
    const result = tryHandleLocalCommand(`/${item.name || ''}`, {
      store,
      client: options.client,
      hasAttachments: options.hasAttachments ?? store.snapshot().attachments.items.length > 0,
    });
    if (result === 'handled') {
      store.setComposerText('');
      store.clearAutocomplete();
      return { handled: true, text: '', cursor: 0, commandResult: result };
    }
    return { handled: Boolean(result), text: value, cursor: options.cursor ?? value.length, commandResult: result };
  }

  if (item.kind === 'local-command-insert' || item.kind === 'remote-command-insert') {
    const next = insertSlashCommandText(item.name || item.label.replace(/^\//, ''));
    store.setComposerText(next.text);
    store.clearAutocomplete();
    return { handled: true, ...next };
  }

  const context = options.context || store.snapshot().autocomplete.context;
  if (!context || context.type !== 'path') return { handled: false, text: value, cursor: options.cursor ?? value.length };

  const pathValue = item.value || item.label.replace(/^@/, '');
  const suffix = item.isDirectory ? '' : ' ';
  const replacement = context.mode === 'mention' ? `@${pathValue}${suffix}` : `${pathValue}${suffix}`;
  const next = replacePromptRange(value, context.replaceStart, context.replaceEnd, replacement);
  store.setComposerText(next.text);
  store.clearAutocomplete();
  return { handled: true, ...next };
}

export function moveAutocompleteSelection(currentIndex: number, itemCount: number, delta: 1 | -1) {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return delta > 0 ? 0 : itemCount - 1;
  return (currentIndex + delta + itemCount) % itemCount;
}
