import type {
  PhoneImageContent,
  PhoneMessageContent,
  PhoneMessageContentPart,
  PhoneRawMessage,
  PhoneTextContent,
  PhoneUiMessage,
  PhoneUsage,
  UnknownRecord,
} from '$lib/types/pi-phone';

const INLINE_USER_CUSTOM_TYPES = new Set(['phone-inline-user-message']);
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const IMAGE_MIME_PATTERN = /^image\/[a-z0-9.+-]+$/i;
const BASE64_PATTERN = /^[a-z0-9+/=\s]+$/i;

type MessageRecord = Record<string, unknown>;

export type AssistantMessageParts = {
  text: string;
  thinking: string;
  toolCalls: Array<{ id: string; name: string; arguments: UnknownRecord }>;
};

export type RenderableImagePart = {
  type: 'image';
  src: string;
  alt: string;
  mediaType?: string;
  filename?: string;
  index: number;
  raw: PhoneImageContent;
};

export type RenderableTextPart = {
  type: 'text';
  text: string;
};

export type RenderableUserContentPart = RenderableTextPart | RenderableImagePart;

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function contentValue(value: unknown) {
  return value as PhoneMessageContent;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isImagePart(part: PhoneMessageContentPart | unknown): part is PhoneImageContent {
  return Boolean(part && typeof part === 'object' && (part as PhoneMessageContentPart).type === 'image');
}

function isTextPart(part: PhoneMessageContentPart | unknown): part is PhoneTextContent {
  return Boolean(part && typeof part === 'object' && (part as PhoneMessageContentPart).type === 'text');
}

export function stripTerminalControlSequences(text = '') {
  return String(text ?? '')
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u009D[^\u009C]*\u009C/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u009B[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

function escapeRawHtmlOutsideFences(markdown: string) {
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceMarker = '';

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = '';
        }
        return line;
      }

      if (inFence) return line;
      return line.replace(/</g, '&lt;');
    })
    .join('\n');
}

export function normalizePiMarkdown(content: unknown) {
  const normalized = stripTerminalControlSequences(String(content ?? '')).replace(/\r\n?/g, '\n');
  return escapeRawHtmlOutsideFences(normalized);
}

export function formatTimestamp(timestamp: unknown) {
  if (!timestamp) return '';
  const date = new Date(timestamp as string | number | Date);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function toDetailString(details: unknown) {
  if (details == null) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function countImages(content: PhoneMessageContent | unknown) {
  if (!Array.isArray(content)) return 0;
  return content.filter((part) => isImagePart(part)).length;
}

export function contentToText(content: PhoneMessageContent | unknown) {
  if (typeof content === 'string') return stripTerminalControlSequences(content);
  if (!Array.isArray(content)) return '';

  return stripTerminalControlSequences(
    content
      .map((part) => {
        if (isTextPart(part)) return typeof part.text === 'string' ? part.text : '';
        if (isImagePart(part)) return '[image]';
        return '';
      })
      .join(' ')
      .trim(),
  );
}

export function userContentDisplayText(content: PhoneMessageContent | unknown) {
  const imageCount = countImages(content);
  if (!Array.isArray(content)) return contentToText(content);

  const text = content
    .filter(isTextPart)
    .map((part) => part.text || '')
    .join('')
    .trim();

  if (text) return text;
  if (imageCount === 1) return '[1 image attached]';
  if (imageCount > 1) return `[${imageCount} images attached]`;
  return contentToText(content);
}

export function safeImageUrl(value: unknown, baseUrl?: string) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  try {
    const base = baseUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    const url = new URL(raw, base);
    if (['http:', 'https:', 'blob:'].includes(url.protocol)) return raw;
    if (url.protocol === 'data:' && IMAGE_DATA_URL_PATTERN.test(raw)) return raw;
  } catch {
    return '';
  }
  return '';
}

export function safeImageDataUrl(data: unknown, mimeType: unknown) {
  if (typeof data !== 'string' || !data.trim()) return '';
  if (typeof mimeType !== 'string' || !IMAGE_MIME_PATTERN.test(mimeType)) return '';
  const normalized = data.replace(/\s+/g, '');
  if (!normalized || !BASE64_PATTERN.test(data)) return '';
  return `data:${mimeType};base64,${normalized}`;
}

export function imageSource(part: PhoneImageContent | unknown) {
  if (!isImagePart(part)) return '';
  const previewUrl = safeImageUrl(part.previewUrl);
  if (previewUrl) return previewUrl;
  const url = safeImageUrl(part.url);
  if (url) return url;
  return safeImageDataUrl(part.data, part.mimeType);
}

export function imageMediaType(part: PhoneImageContent | unknown) {
  if (!isImagePart(part)) return undefined;
  if (typeof part.mimeType === 'string' && IMAGE_MIME_PATTERN.test(part.mimeType)) return part.mimeType;
  const src = imageSource(part);
  const match = src.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  return match?.[1];
}

export function renderableUserContent(content: PhoneMessageContent | unknown, fallbackText = ''): RenderableUserContentPart[] {
  if (!Array.isArray(content)) {
    const text = typeof content === 'string' ? content : fallbackText;
    return text ? [{ type: 'text', text: stripTerminalControlSequences(text) }] : [];
  }

  const parts: RenderableUserContentPart[] = [];
  let imageIndex = 0;

  for (const part of content) {
    if (isTextPart(part)) {
      const text = String(part.text || '');
      if (text.trim()) parts.push({ type: 'text', text: stripTerminalControlSequences(text) });
      continue;
    }

    if (!isImagePart(part)) continue;
    const src = imageSource(part);
    if (!src) continue;
    imageIndex += 1;
    const filename = typeof part.name === 'string' ? part.name : undefined;
    parts.push({
      type: 'image',
      src,
      alt: filename || `Attached image ${imageIndex}`,
      mediaType: imageMediaType(part),
      filename,
      index: imageIndex,
      raw: part,
    });
  }

  if (!parts.length && fallbackText) return [{ type: 'text', text: stripTerminalControlSequences(fallbackText) }];
  return parts;
}

export function assistantParts(content: PhoneMessageContent | unknown): AssistantMessageParts {
  const parts: AssistantMessageParts = { text: '', thinking: '', toolCalls: [] };
  if (!Array.isArray(content)) return parts;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') parts.text += stripTerminalControlSequences(typeof block.text === 'string' ? block.text : '');
    if (block.type === 'thinking') {
      parts.thinking += stripTerminalControlSequences(typeof block.thinking === 'string' ? block.thinking : '');
    }
    if (block.type === 'toolCall') {
      parts.toolCalls.push({
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : 'tool',
        arguments: isRecord(block.arguments) ? block.arguments : {},
      });
    }
  }

  return parts;
}

export function transformPhoneMessage(message: PhoneRawMessage | unknown, index: number | string = Date.now()): PhoneUiMessage[] {
  if (!message || typeof message !== 'object') return [];
  const item = message as MessageRecord;
  const role = textValue(item.role);
  const timestamp = item.timestamp;

  if (role === 'user') {
    const content = contentValue(item.content);
    return [
      {
        id: `user-${timestamp || index}`,
        kind: 'user',
        meta: formatTimestamp(timestamp),
        text: userContentDisplayText(content),
        rawContent: content,
        imageCount: countImages(content),
      },
    ];
  }

  if (role === 'assistant') {
    const content = contentValue(item.content);
    const parts = assistantParts(content);
    const model = textValue(item.model);
    const stopReason = textValue(item.stopReason);
    const usage = isRecord(item.usage) ? (item.usage as PhoneUsage) : undefined;
    return [
      {
        id: `assistant-${timestamp || index}`,
        kind: 'assistant',
        meta: [model, formatTimestamp(timestamp)].filter(Boolean).join(' · '),
        text: parts.text,
        thinking: parts.thinking,
        toolCalls: parts.toolCalls,
        usage,
        stopReason: stopReason || undefined,
        details: item.details,
      },
    ];
  }

  if (role === 'toolResult') {
    const content = contentValue(item.content);
    const toolCallId = textValue(item.toolCallId);
    const toolName = textValue(item.toolName, 'tool');
    return [
      {
        id: `tool-${toolCallId || timestamp || index}`,
        kind: 'tool',
        toolCallId,
        toolName,
        title: toolName,
        status: item.isError ? 'error' : 'done',
        text: contentToText(content),
        rawContent: content,
        meta: formatTimestamp(timestamp),
        details: item.details,
      },
    ];
  }

  if (role === 'bashExecution') {
    const command = textValue(item.command);
    return [
      {
        id: `bash-${timestamp || index}`,
        kind: 'tool',
        toolName: 'bash',
        title: `bash · ${command}`,
        command,
        args: { command },
        status: item.cancelled ? 'cancelled' : 'done',
        text: textValue(item.output),
        meta: formatTimestamp(timestamp),
        details: {
          exitCode: item.exitCode,
          truncated: item.truncated,
          fullOutputPath: item.fullOutputPath,
        },
      },
    ];
  }

  if (role === 'custom') {
    if (item.display === false) return [];
    const customType = textValue(item.customType);
    const content = contentValue(item.content);

    if (INLINE_USER_CUSTOM_TYPES.has(customType)) {
      return [
        {
          id: `custom-user-${timestamp || index}`,
          kind: 'user',
          meta: formatTimestamp(timestamp),
          text: userContentDisplayText(content),
          rawContent: content,
          imageCount: countImages(content),
        },
      ];
    }

    return [
      {
        id: `custom-${timestamp || index}`,
        kind: 'custom',
        title: customType || 'extension',
        customType: customType || undefined,
        text: contentToText(content),
        rawContent: content,
        meta: formatTimestamp(timestamp),
        details: item.details,
        imageCount: countImages(content),
      },
    ];
  }

  if (role === 'branchSummary') {
    const fromId = item.fromId;
    return [
      {
        id: `branch-summary-${timestamp || index}`,
        kind: 'summary',
        summaryKind: 'branch',
        title: 'Branch summary',
        text: textValue(item.summary),
        meta: formatTimestamp(timestamp),
        fromId,
        details: fromId == null ? undefined : { fromId },
      },
    ];
  }

  if (role === 'compactionSummary') {
    const tokensBefore = numberValue(item.tokensBefore);
    return [
      {
        id: `compaction-summary-${timestamp || index}`,
        kind: 'summary',
        summaryKind: 'compaction',
        title: `Compaction summary${tokensBefore ? ` · ${tokensBefore.toLocaleString()} tokens` : ''}`,
        text: textValue(item.summary),
        meta: formatTimestamp(timestamp),
        tokensBefore,
        details: tokensBefore == null ? undefined : { tokensBefore },
      },
    ];
  }

  return [];
}

export function transformPhoneMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message, index) => transformPhoneMessage(message, index));
}

function stableDetailValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function assistantToolCallSignature(message: PhoneUiMessage) {
  if (message.kind !== 'assistant') return '';
  return stableDetailValue(message.toolCalls || []);
}

/**
 * True when a settled live assistant is already represented by the latest
 * canonical message list. This can happen when a get_messages refresh wins the
 * race with a trailing message_end event. The old UI kept the final assistant
 * in the transient live slot until refresh; the Svelte UI also guards the
 * rendered item list so that race never produces a duplicate final answer.
 */
export function isDuplicateSettledAssistant(messages: PhoneUiMessage[], liveAssistant: PhoneUiMessage | null | undefined) {
  if (!liveAssistant || liveAssistant.kind !== 'assistant' || liveAssistant.live) return false;
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.kind !== 'assistant') return false;
  if (lastMessage.id === liveAssistant.id) return true;

  return (
    (lastMessage.text || '') === (liveAssistant.text || '')
    && (lastMessage.thinking || '') === (liveAssistant.thinking || '')
    && (lastMessage.meta || '') === (liveAssistant.meta || '')
    && assistantToolCallSignature(lastMessage) === assistantToolCallSignature(liveAssistant)
    && stableDetailValue(lastMessage.details) === stableDetailValue(liveAssistant.details)
  );
}

export function enrichToolItems(items: PhoneUiMessage[]) {
  const toolCalls = new Map<string, { arguments: UnknownRecord }>();
  for (const item of items) {
    if (item.kind !== 'assistant') continue;
    for (const toolCall of item.toolCalls || []) {
      if (toolCall.id) toolCalls.set(toolCall.id, toolCall);
    }
  }

  return items.map((item) => {
    if (item.kind !== 'tool' || item.args || !item.toolCallId) return item;
    const linked = toolCalls.get(item.toolCallId);
    if (!linked) return item;
    return { ...item, args: linked.arguments || {} };
  });
}

export function conversationItems(
  messages: PhoneUiMessage[],
  liveTools: Map<string, Extract<PhoneUiMessage, { kind: 'tool' }>> | Iterable<Extract<PhoneUiMessage, { kind: 'tool' }>>,
  liveAssistant: PhoneUiMessage | null | undefined,
) {
  const items = [...messages];
  const tools = liveTools instanceof Map ? liveTools.values() : liveTools;
  for (const tool of tools) items.push(tool);
  if (liveAssistant && !isDuplicateSettledAssistant(messages, liveAssistant)) items.push(liveAssistant);
  return enrichToolItems(items);
}
