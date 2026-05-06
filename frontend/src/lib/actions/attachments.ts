import type { PhoneStateStore } from '$lib/stores/pi-phone-state';
import type { PhoneAttachmentRecord, PhoneImageContent, PhoneMessageContent, PhoneMessageContentPart } from '$lib/types/pi-phone';

export const INLINE_IMAGE_TOKEN_PATTERN = /⟦img\d+⟧|\{img\d*\}/g;

export type PhonePromptImagePayload = Required<Pick<PhoneImageContent, 'type' | 'data' | 'mimeType'>>;

export type PromptTextSelection = {
  text: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

export type PromptTextEdit = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export type TextEditResult = PromptTextEdit;

export type AddImageAttachmentsResult = PromptTextEdit & {
  added: PhoneAttachmentRecord[];
  rejected: File[];
  insertion: string;
};

export type SyncAttachmentsResult = {
  kept: PhoneAttachmentRecord[];
  removed: PhoneAttachmentRecord[];
};

export type BuildPromptPayloadResult = {
  message: string;
  images: PhonePromptImagePayload[];
};

function createObjectUrl(file: File) {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(file);
  }
  return '';
}

export function filterImageFiles(files: File[] | FileList | Iterable<File> | null | undefined) {
  const incoming = Array.from(files || []);
  const accepted = incoming.filter((file) => String(file.type || '').startsWith('image/'));
  const rejected = incoming.filter((file) => !String(file.type || '').startsWith('image/'));
  return { accepted, rejected };
}

export function createAttachmentRecord(file: File, tokenOrder: number): PhoneAttachmentRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    url: createObjectUrl(file),
    token: `⟦img${tokenOrder}⟧`,
    tokenOrder,
  };
}

export function disposeAttachment(attachment: Pick<PhoneAttachmentRecord, 'url'> | null | undefined) {
  if (attachment?.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(attachment.url);
  }
}

export function disposeAttachments(attachments: Iterable<Pick<PhoneAttachmentRecord, 'url'>> | null | undefined) {
  for (const attachment of attachments || []) disposeAttachment(attachment);
}

export function orderedAttachments(attachments: PhoneAttachmentRecord[], promptText = '') {
  return [...attachments].sort((left, right) => {
    const leftIndex = promptText.indexOf(left.token);
    const rightIndex = promptText.indexOf(right.token);
    const leftMissing = leftIndex === -1;
    const rightMissing = rightIndex === -1;

    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (!leftMissing && leftIndex !== rightIndex) return leftIndex - rightIndex;
    return (left.tokenOrder || 0) - (right.tokenOrder || 0);
  });
}

export function buildTokenInsertion(promptText: string, selectionStart: number, selectionEnd: number, tokens: string[]) {
  if (!tokens.length) return '';

  const value = String(promptText || '');
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const beforeChar = start > 0 ? value[start - 1] : '';
  const afterChar = end < value.length ? value[end] : '';
  const needsLeadingSpace = Boolean(beforeChar && !/\s/.test(beforeChar));
  const needsTrailingSpace = Boolean(!afterChar || !/\s/.test(afterChar));

  return `${needsLeadingSpace ? ' ' : ''}${tokens.join(' ')}${needsTrailingSpace ? ' ' : ''}`;
}

export function insertTextAtSelection({ text, selectionStart, selectionEnd }: PromptTextSelection, insertion: string): PromptTextEdit {
  const value = String(text || '');
  const start = Math.max(0, Math.min(value.length, selectionStart ?? value.length));
  const end = Math.max(start, Math.min(value.length, selectionEnd ?? start));
  const nextText = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const nextSelection = start + insertion.length;
  return { text: nextText, selectionStart: nextSelection, selectionEnd: nextSelection };
}

export function insertTokensAtSelection(selection: PromptTextSelection, tokens: string[]): PromptTextEdit & { insertion: string } {
  const text = String(selection.text || '');
  const start = selection.selectionStart ?? text.length;
  const end = selection.selectionEnd ?? start;
  const insertion = buildTokenInsertion(text, start, end, tokens);
  return { ...insertTextAtSelection(selection, insertion), insertion };
}

export function stripTokenFromPrompt(
  token: string,
  { text, selectionStart, selectionEnd }: PromptTextSelection,
): PromptTextEdit & { changed: boolean } {
  const value = String(text || '');
  if (!token || !value.includes(token)) {
    const cursor = Math.max(0, Math.min(value.length, selectionStart ?? value.length));
    const cursorEnd = Math.max(cursor, Math.min(value.length, selectionEnd ?? cursor));
    return { text: value, selectionStart: cursor, selectionEnd: cursorEnd, changed: false };
  }

  let nextText = '';
  let nextSelectionStart = selectionStart ?? value.length;
  let nextSelectionEnd = selectionEnd ?? nextSelectionStart;
  let offset = 0;

  while (offset < value.length) {
    const index = value.indexOf(token, offset);
    if (index === -1) break;

    nextText += value.slice(offset, index);

    if (index < nextSelectionStart) {
      nextSelectionStart -= Math.min(token.length, nextSelectionStart - index);
    }
    if (index < nextSelectionEnd) {
      nextSelectionEnd -= Math.min(token.length, nextSelectionEnd - index);
    }

    offset = index + token.length;
  }

  nextText += value.slice(offset);
  const clampedStart = Math.max(0, Math.min(nextText.length, nextSelectionStart));
  const clampedEnd = Math.max(clampedStart, Math.min(nextText.length, nextSelectionEnd));
  return { text: nextText, selectionStart: clampedStart, selectionEnd: clampedEnd, changed: nextText !== value };
}

export function syncAttachmentRecordsWithPrompt(
  attachments: PhoneAttachmentRecord[],
  promptText: string,
): SyncAttachmentsResult {
  const kept: PhoneAttachmentRecord[] = [];
  const removed: PhoneAttachmentRecord[] = [];

  for (const attachment of attachments) {
    if (String(promptText || '').includes(attachment.token)) kept.push(attachment);
    else removed.push(attachment);
  }

  return { kept, removed };
}

export function attachmentOccurrences(attachments: PhoneAttachmentRecord[], promptText: string) {
  const matches: Array<{ index: number; attachment: PhoneAttachmentRecord }> = [];
  const value = String(promptText || '');

  for (const attachment of attachments) {
    let offset = 0;
    while (offset <= value.length) {
      const index = value.indexOf(attachment.token, offset);
      if (index === -1) break;
      matches.push({ index, attachment });
      offset = index + attachment.token.length;
    }
  }

  matches.sort((left, right) => left.index - right.index || (left.attachment.tokenOrder || 0) - (right.attachment.tokenOrder || 0));
  return matches.map((match) => match.attachment);
}

async function fileToBase64(file: File) {
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.split(',')[1] || '' : result);
      };
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  const buffer = await file.arrayBuffer();
  const globalBuffer = globalThis as typeof globalThis & { Buffer?: { from(input: ArrayBuffer): { toString(encoding: 'base64'): string } } };
  if (globalBuffer.Buffer) return globalBuffer.Buffer.from(buffer).toString('base64');

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function buildPromptPayload(
  promptText: string,
  attachmentsOrOptions: PhoneAttachmentRecord[] | { store?: PhoneStateStore } = [],
): Promise<BuildPromptPayloadResult> {
  const rawPrompt = String(promptText || '');
  const attachments = Array.isArray(attachmentsOrOptions) ? attachmentsOrOptions : attachmentsOrOptions.store?.snapshot().attachments.items;
  if (!attachments) throw new Error('A PhoneStateStore is required to build an attachment prompt payload.');
  const ordered = attachmentOccurrences(attachments, rawPrompt);
  const images = await Promise.all(
    ordered.map(async (attachment) => ({
      type: 'image' as const,
      data: await fileToBase64(attachment.file),
      mimeType: attachment.type || 'image/png',
    })),
  );

  return { message: rawPrompt, images };
}

export function buildInlineDisplayContent(text: string, images: PhoneImageContent[]): PhoneMessageContent {
  const value = String(text || '');
  if (!images.length) return value;

  INLINE_IMAGE_TOKEN_PATTERN.lastIndex = 0;
  const matches = [...value.matchAll(INLINE_IMAGE_TOKEN_PATTERN)];
  if (!matches.length) return value;

  const content: PhoneMessageContentPart[] = [];
  let lastIndex = 0;
  let imageIndex = 0;

  for (const match of matches) {
    const token = match[0] || '';
    const index = match.index ?? -1;
    if (index < 0) continue;

    const before = value.slice(lastIndex, index);
    if (before) content.push({ type: 'text', text: before });

    const image = images[imageIndex];
    if (image?.type === 'image' && image.data && image.mimeType) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
      imageIndex += 1;
    } else {
      content.push({ type: 'text', text: token });
    }

    lastIndex = index + token.length;
  }

  const after = value.slice(lastIndex);
  if (after) content.push({ type: 'text', text: after });

  while (imageIndex < images.length) {
    const image = images[imageIndex];
    if (image?.type === 'image' && image.data && image.mimeType) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    }
    imageIndex += 1;
  }

  return content;
}

export function addImageAttachmentsFromFiles(
  stateStore: PhoneStateStore,
  files: File[] | FileList | Iterable<File> | null | undefined,
  selection: PromptTextSelection,
): AddImageAttachmentsResult {
  const { accepted, rejected } = filterImageFiles(files);
  const added = accepted.map((file) => createAttachmentRecord(file, stateStore.allocateAttachmentTokenId()));
  if (added.length) stateStore.addAttachments(added);

  const edit = insertTokensAtSelection(selection, added.map((attachment) => attachment.token));
  if (added.length) stateStore.setComposerText(edit.text);

  return { ...edit, added, rejected };
}

export function addImageAttachments(
  files: File[] | FileList | Iterable<File> | null | undefined,
  options: { store?: PhoneStateStore; text: string; selection?: { start?: number; end?: number } },
) {
  if (!options.store) throw new Error('A PhoneStateStore is required to add attachments.');
  const result = addImageAttachmentsFromFiles(options.store, files, {
    text: options.text,
    selectionStart: options.selection?.start ?? options.text.length,
    selectionEnd: options.selection?.end ?? options.selection?.start ?? options.text.length,
  });
  return { ...result, textEdit: result.added.length ? { text: result.text, selectionStart: result.selectionStart, selectionEnd: result.selectionEnd } : null };
}

export function syncAttachmentsWithPrompt(stateStore: PhoneStateStore, promptText: string): PhoneAttachmentRecord[];
export function syncAttachmentsWithPrompt(promptText: string, options: { store?: PhoneStateStore }): PhoneAttachmentRecord[];
export function syncAttachmentsWithPrompt(
  first: PhoneStateStore | string,
  second: string | { store?: PhoneStateStore } = '',
) {
  const stateStore = typeof first === 'string' ? (typeof second === 'object' ? second.store : undefined) : first;
  if (!stateStore) throw new Error('A PhoneStateStore is required for attachment prompt sync.');
  const promptText = typeof first === 'string' ? first : String(second || '');
  const current = stateStore.snapshot().attachments.items;
  const result = syncAttachmentRecordsWithPrompt(current, promptText);
  if (result.removed.length) {
    disposeAttachments(result.removed);
    stateStore.setAttachments(result.kept);
  }
  return result.removed;
}

export function removeAttachmentFromPrompt(
  stateStore: PhoneStateStore,
  id: string,
  selection: PromptTextSelection,
): (PromptTextEdit & { removed: PhoneAttachmentRecord | null }) {
  const removed = stateStore.removeAttachment(id);
  if (!removed) {
    const value = String(selection.text || '');
    const cursor = Math.max(0, Math.min(value.length, selection.selectionStart ?? value.length));
    return { text: value, selectionStart: cursor, selectionEnd: cursor, removed: null };
  }

  const edit = stripTokenFromPrompt(removed.token, selection);
  disposeAttachment(removed);
  stateStore.setComposerText(edit.text);
  return { text: edit.text, selectionStart: edit.selectionStart, selectionEnd: edit.selectionEnd, removed };
}

export function removeAttachmentAndToken(
  id: string,
  options: { store?: PhoneStateStore; text: string; selection?: { start?: number; end?: number } },
) {
  if (!options.store) throw new Error('A PhoneStateStore is required to remove attachments.');
  const result = removeAttachmentFromPrompt(options.store, id, {
    text: options.text,
    selectionStart: options.selection?.start ?? options.text.length,
    selectionEnd: options.selection?.end ?? options.selection?.start ?? options.text.length,
  });
  return { ...result, textEdit: result.removed ? { text: result.text, selectionStart: result.selectionStart, selectionEnd: result.selectionEnd } : null };
}

export function clearComposerAttachments(
  stateStore: PhoneStateStore,
  options: { removeTokensFromPrompt?: boolean; text?: string } = {},
): PromptTextEdit {
  const state = stateStore.snapshot();
  const removed = stateStore.clearAttachments();
  disposeAttachments(removed);

  let nextText = String(options.text ?? state.composer.text ?? '');
  let selectionStart = nextText.length;
  let selectionEnd = nextText.length;

  if (options.removeTokensFromPrompt) {
    for (const attachment of removed) {
      const edit = stripTokenFromPrompt(attachment.token, { text: nextText, selectionStart, selectionEnd });
      nextText = edit.text;
      selectionStart = edit.selectionStart;
      selectionEnd = edit.selectionEnd;
    }
    stateStore.setComposerText(nextText);
  }

  return { text: nextText, selectionStart, selectionEnd };
}

export function clearAttachmentRecords(options: { store?: PhoneStateStore; removeTokensFromPrompt?: boolean } = {}) {
  if (!options.store) throw new Error('A PhoneStateStore is required to clear attachments.');
  return clearComposerAttachments(options.store, { removeTokensFromPrompt: options.removeTokensFromPrompt });
}

export function registerAttachmentObjectUrlCleanup(stateStore: PhoneStateStore, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {
  const handler = () => disposeAttachments(stateStore.snapshot().attachments.items);
  target.addEventListener('beforeunload', handler);
  return () => target.removeEventListener('beforeunload', handler);
}
