import { safeImageDataUrl, stripTerminalControlSequences } from '$lib/adapters/message-adapter';
import type { PhoneDiffLine, PhoneMessageContent, PhoneToolStatus, PhoneUiToolMessage, UnknownRecord } from '$lib/types/pi-phone';
import type { SupportedLanguage } from '$lib/components/ai-elements/code/shiki';

export const TOOL_LANGUAGE_LABELS: Record<string, string> = {
  c: 'C',
  cc: 'C++',
  cpp: 'C++',
  css: 'CSS',
  go: 'Go',
  h: 'Header',
  hpp: 'C++',
  html: 'HTML',
  java: 'Java',
  js: 'JS',
  jsx: 'JSX',
  json: 'JSON',
  kt: 'Kotlin',
  md: 'Markdown',
  mjs: 'JS',
  php: 'PHP',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  scss: 'SCSS',
  sh: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  toml: 'TOML',
  ts: 'TypeScript',
  tsx: 'TSX',
  txt: 'Text',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Shell',
};

export const TOOL_PREVIEW_LIMITS = {
  diff: 80,
  diffLive: 120,
  code: 24,
  write: 24,
  writeLive: 30,
  read: 32,
  readLive: 60,
  markdown: 90,
  terminal: 80,
  bash: 100,
  bashLive: 140,
  grepFiles: 10,
  grepLinesPerFile: 8,
  find: 60,
  ls: 80,
} as const;

const SUPPORTED_LANGUAGE_BY_EXTENSION: Record<string, SupportedLanguage> = {
  css: 'css',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'text',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  svelte: 'svelte',
  ts: 'typescript',
  tsx: 'tsx',
  zsh: 'bash',
};

export type ToolPreviewBadgeVariant = 'neutral' | 'accent' | 'added' | 'removed' | 'warning';

export type ToolPreviewBadge = {
  label: string;
  variant?: ToolPreviewBadgeVariant;
};

export type ToolCodePreviewSection = {
  type: 'code';
  code: string;
  lang: SupportedLanguage;
  startLine?: number;
  hiddenCount?: number;
  notice?: string;
  emptyLabel?: string;
};

export type ToolTerminalPreviewSection = {
  type: 'terminal';
  code: string;
  lang: SupportedLanguage;
  hiddenCount?: number;
  notice?: string;
};

export type ToolMarkdownPreviewSection = {
  type: 'markdown';
  markdown: string;
  hiddenCount?: number;
  notice?: string;
};

export type ToolImagePreviewSection = {
  type: 'image';
  src: string;
  alt: string;
};

export type ToolDiffPreviewSection = {
  type: 'diff';
  lines: PhoneDiffLine[];
  hiddenCount?: number;
  stats: { added: number; removed: number };
};

export type ToolGrepEntry = {
  kind: 'match' | 'context';
  path: string;
  lineNumber: number;
  text: string;
};

export type ToolGrepGroup = {
  path: string;
  entries: ToolGrepEntry[];
  hiddenCount: number;
};

export type ToolGrepPreviewSection = {
  type: 'grep';
  groups: ToolGrepGroup[];
  matchCount: number;
  fileCount: number;
  hiddenFileCount: number;
  notice?: string;
  fallback?: string;
};

export type ToolListEntry = {
  text: string;
  kind: 'directory' | 'file';
};

export type ToolListPreviewSection = {
  type: 'list';
  entries: ToolListEntry[];
  hiddenCount?: number;
  notice?: string;
  emptyLabel?: string;
};

export type ToolTextPreviewSection = {
  type: 'text';
  text: string;
};

export type ToolPreviewSection =
  | ToolCodePreviewSection
  | ToolTerminalPreviewSection
  | ToolMarkdownPreviewSection
  | ToolImagePreviewSection
  | ToolDiffPreviewSection
  | ToolGrepPreviewSection
  | ToolListPreviewSection
  | ToolTextPreviewSection;

export type ToolRichPreview = {
  id: string;
  panelKey: string;
  toolName: string;
  normalizedName: string;
  status: PhoneToolStatus;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  statusLabel: string;
  eyebrow: string;
  subject: string;
  artifact: boolean;
  defaultOpen: boolean;
  open: boolean;
  badges: ToolPreviewBadge[];
  note?: string;
  input?: UnknownRecord;
  errorText?: string;
  sections: ToolPreviewSection[];
};

function asRecord(value: unknown): UnknownRecord | null {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? (value as UnknownRecord) : null;
}

export function normalizeNewlines(value: unknown) {
  return stripTerminalControlSequences(String(value ?? '')).replace(/\r\n?/g, '\n');
}

export function countTextLines(text = '') {
  const normalized = normalizeNewlines(text);
  if (!normalized) return 0;
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function normalizedToolName(name = '') {
  return String(name || '').trim().split(' · ')[0].toLowerCase();
}

export const normalizeToolName = normalizedToolName;

function extensionForPath(filePath = '') {
  const match = String(filePath || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function detectLanguageLabel(filePath = '') {
  const extension = extensionForPath(filePath);
  if (!extension) return '';
  return TOOL_LANGUAGE_LABELS[extension] || extension.toUpperCase();
}

export function detectSupportedLanguage(filePath = '', fallback: SupportedLanguage = 'text'): SupportedLanguage {
  const extension = extensionForPath(filePath);
  return SUPPORTED_LANGUAGE_BY_EXTENSION[extension] || fallback;
}

export function getToolPath(item: PhoneUiToolMessage) {
  if (typeof item.args?.path === 'string') return item.args.path;
  const details = asRecord(item.details);
  return typeof details?.path === 'string' ? details.path : '';
}

export function splitToolNotice(text = '') {
  const lines = normalizeNewlines(text).split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const lastLine = lines[lines.length - 1] || '';
  if (lastLine.startsWith('[') && /(Use offset=|limit reached|truncated|saved to temp file|full output)/i.test(lastLine)) {
    lines.pop();
    return { body: lines.join('\n'), notice: lastLine };
  }

  return { body: lines.join('\n'), notice: '' };
}

export function parseNumberedDiffLines(diffText = ''): PhoneDiffLine[] {
  const normalized = normalizeNewlines(diffText);
  if (!normalized.trim()) return [];

  return normalized
    .split('\n')
    .map((line) => {
      const match = line.match(/^([+\-\s])(\s*\d*)\s(.*)$/);
      if (!match) return { kind: 'meta' as const, prefix: '', lineNumber: '', text: line };
      const prefix = match[1];
      return {
        kind: prefix === '+' ? ('added' as const) : prefix === '-' ? ('removed' as const) : ('context' as const),
        prefix,
        lineNumber: match[2].trim(),
        text: match[3] || '',
      };
    })
    .filter((line) => line.kind !== 'meta' || line.text.trim());
}

export function buildEditPreviewLines(oldText = '', newText = ''): PhoneDiffLine[] {
  const oldLines = normalizeNewlines(oldText).split('\n');
  const newLines = normalizeNewlines(newText).split('\n');
  if (oldLines.length === 1 && oldLines[0] === '' && newLines.length === 1 && newLines[0] === '') return [];

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const lines: PhoneDiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) {
    lines.push({ kind: 'context', prefix: ' ', lineNumber: String(index + 1), text: oldLines[index] || '' });
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    lines.push({ kind: 'removed', prefix: '-', lineNumber: String(index + 1), text: oldLines[index] || '' });
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    lines.push({ kind: 'added', prefix: '+', lineNumber: String(index + 1), text: newLines[index] || '' });
  }
  for (let index = suffix; index > 0; index -= 1) {
    const oldIndex = oldLines.length - index;
    const newIndex = newLines.length - index;
    lines.push({
      kind: 'context',
      prefix: ' ',
      lineNumber: String(newIndex + 1),
      text: newLines[newIndex] || oldLines[oldIndex] || '',
    });
  }
  return lines;
}

export function computeDiffStats(lines: PhoneDiffLine[]) {
  return lines.reduce(
    (stats, line) => {
      if (line.kind === 'added') stats.added += 1;
      if (line.kind === 'removed') stats.removed += 1;
      return stats;
    },
    { added: 0, removed: 0 },
  );
}

export function limitedDiffSection(lines: PhoneDiffLine[], limit = 80): ToolDiffPreviewSection {
  const visible = lines.slice(0, limit);
  return { type: 'diff', lines: visible, hiddenCount: Math.max(0, lines.length - visible.length), stats: computeDiffStats(lines) };
}

export function codePreviewSection(
  text = '',
  { limit = 24, startLine = 1, emptyLabel = 'Empty file.', lang = 'text' as SupportedLanguage } = {},
): ToolCodePreviewSection {
  const { body, notice } = splitToolNotice(text);
  const allLines = normalizeNewlines(body).split('\n');
  if (allLines.length > 1 && allLines[allLines.length - 1] === '') allLines.pop();
  const visible = allLines.slice(0, limit);
  const code = visible.length ? visible.join('\n') : emptyLabel;
  return {
    type: 'code',
    code,
    lang,
    startLine,
    hiddenCount: Math.max(0, allLines.length - visible.length),
    notice,
    emptyLabel,
  };
}

export function markdownPreviewSection(text = '', { limit = 80 } = {}): ToolMarkdownPreviewSection {
  const { body, notice } = splitToolNotice(text);
  const lines = normalizeNewlines(body).split('\n');
  const visible = lines.slice(0, limit).join('\n').trim();
  return {
    type: 'markdown',
    markdown: visible || '(empty markdown file)',
    hiddenCount: Math.max(0, lines.length - limit),
    notice,
  };
}

export function terminalPreviewSection(text = '', { limit = 80, lang = 'bash' as SupportedLanguage } = {}): ToolTerminalPreviewSection {
  const { body, notice } = splitToolNotice(text);
  const lines = normalizeNewlines(body).split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const visible = lines.slice(0, limit);
  return {
    type: 'terminal',
    code: visible.length ? visible.join('\n') : '(no output)',
    lang,
    hiddenCount: Math.max(0, lines.length - visible.length),
    notice,
  };
}

export function summarizeRange(startLine: number, lineCount: number) {
  if (!lineCount) return '';
  const endLine = startLine + lineCount - 1;
  return startLine === endLine ? `L${startLine}` : `${startLine}-${endLine}`;
}

export function isMarkdownPath(filePath = '') {
  return /\.(md|markdown|mdx)$/i.test(filePath);
}

export function firstImageSource(content: PhoneMessageContent | null | undefined) {
  if (!Array.isArray(content)) return '';
  const image = content.find((part) => part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string');
  return image ? safeImageDataUrl(image.data, image.mimeType) : '';
}

export function parseGrepMatches(text = '') {
  const { body, notice } = splitToolNotice(text);
  const lines = normalizeNewlines(body).split('\n').filter((line) => line.trim());
  const entries: ToolGrepEntry[] = [];

  for (const line of lines) {
    let match = line.match(/^(.+?):(\d+):\s?(.*)$/);
    if (match) {
      entries.push({ path: match[1], lineNumber: Number(match[2]), text: match[3] || '', kind: 'match' });
      continue;
    }
    match = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
    if (match) entries.push({ path: match[1], lineNumber: Number(match[2]), text: match[3] || '', kind: 'context' });
  }

  const deduped: ToolGrepEntry[] = [];
  let previousKey = '';
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.path}:${entry.lineNumber}:${entry.text}`;
    if (key === previousKey) continue;
    previousKey = key;
    deduped.push(entry);
  }

  return { entries: deduped, notice, body };
}

export function buildGrepPreview(text = '', { limitFiles = 8, limitLinesPerFile = 10 } = {}): ToolGrepPreviewSection {
  const { entries, notice, body } = parseGrepMatches(text);
  if (!entries.length) {
    return {
      type: 'grep',
      groups: [],
      matchCount: 0,
      fileCount: 0,
      hiddenFileCount: 0,
      notice,
      fallback: body || 'No matches.',
    };
  }

  const grouped = new Map<string, ToolGrepEntry[]>();
  for (const entry of entries) {
    if (!grouped.has(entry.path)) grouped.set(entry.path, []);
    grouped.get(entry.path)?.push(entry);
  }

  const fileEntries = [...grouped.entries()];
  const visibleFiles = fileEntries.slice(0, limitFiles);
  return {
    type: 'grep',
    groups: visibleFiles.map(([path, items]) => {
      const visible = items.slice(0, limitLinesPerFile);
      return { path, entries: visible, hiddenCount: Math.max(0, items.length - visible.length) };
    }),
    matchCount: entries.filter((entry) => entry.kind === 'match').length,
    fileCount: fileEntries.length,
    hiddenFileCount: Math.max(0, fileEntries.length - visibleFiles.length),
    notice,
  };
}

export function parseListEntries(text = '') {
  const { body, notice } = splitToolNotice(text);
  return { entries: normalizeNewlines(body).split('\n').filter((line) => line.trim()), notice };
}

export function listPreviewSection(entries: string[], { limit = 40, notice = '', emptyLabel = 'No results.' } = {}): ToolListPreviewSection {
  const visible = entries.slice(0, limit);
  return {
    type: 'list',
    entries: visible.map((entry) => ({ text: entry, kind: entry.endsWith('/') ? 'directory' : 'file' })),
    hiddenCount: Math.max(0, entries.length - visible.length),
    notice,
    emptyLabel,
  };
}

function statusLabel(status: PhoneToolStatus) {
  if (status === 'running') return 'Running';
  if (status === 'error') return 'Error';
  if (status === 'cancelled') return 'Cancelled';
  return 'Done';
}

function toolState(status: PhoneToolStatus): ToolRichPreview['state'] {
  if (status === 'running') return 'input-available';
  if (status === 'error') return 'output-error';
  return 'output-available';
}

function basePreview(item: PhoneUiToolMessage): ToolRichPreview {
  const toolName = item.toolName || item.title || 'tool';
  const normalizedName = normalizedToolName(toolName);
  const status = item.status || 'done';
  return {
    id: item.id,
    panelKey: item.id,
    toolName,
    normalizedName,
    status,
    state: toolState(status),
    statusLabel: statusLabel(status),
    eyebrow: item.live ? 'Tool running' : 'Tool result',
    subject: toolName,
    artifact: false,
    defaultOpen: status === 'running' || status === 'error',
    open: status === 'running' || status === 'error',
    badges: status === 'running' ? [{ label: 'running', variant: 'accent' }] : [],
    input: item.args || (item.command ? { command: item.command } : undefined),
    errorText: status === 'error' ? item.text || 'Tool error' : undefined,
    sections: [],
  };
}

function applyFallback(preview: ToolRichPreview, item: PhoneUiToolMessage) {
  if (preview.sections.length || preview.errorText) return preview;
  const text = item.status === 'cancelled' && !item.text ? 'Cancelled' : item.text || '';
  if (text) preview.sections.push({ type: 'terminal', code: text, lang: 'text' });
  else if (item.status === 'running') preview.sections.push({ type: 'text', text: 'Running…' });
  return preview;
}

export function readToolPayload(item: PhoneUiToolMessage) {
  const path = getToolPath(item);
  const text = item.text || '';
  const offset = Number(item.args?.offset);
  const startLine = Number.isFinite(offset) && offset > 0 ? offset : 1;
  const { body, notice } = splitToolNotice(text);
  return {
    path,
    text,
    startLine,
    body,
    notice,
    rawContent: item.rawContent || null,
    imageSrc: firstImageSource(item.rawContent),
    languageLabel: detectLanguageLabel(path),
    lang: detectSupportedLanguage(path),
    lineCount: countTextLines(body),
    isMarkdown: isMarkdownPath(path),
  };
}

export function editToolPayload(item: PhoneUiToolMessage) {
  const details = asRecord(item.details);
  const path = getToolPath(item);
  const diffLines = typeof details?.diff === 'string'
    ? parseNumberedDiffLines(details.diff)
    : buildEditPreviewLines(String(item.args?.oldText || ''), String(item.args?.newText || ''));
  return {
    path,
    diffLines,
    stats: computeDiffStats(diffLines),
    firstChangedLine: typeof details?.firstChangedLine === 'number' ? details.firstChangedLine : undefined,
    generatedFromReplacement: typeof details?.diff !== 'string',
  };
}

export function writeToolPayload(item: PhoneUiToolMessage) {
  const path = getToolPath(item);
  const content = typeof item.args?.content === 'string' ? item.args.content : '';
  const lineCount = countTextLines(content);
  const byteCount = typeof TextEncoder === 'function' ? new TextEncoder().encode(content).length : content.length;
  return { path, content, lineCount, byteCount, languageLabel: detectLanguageLabel(path), lang: detectSupportedLanguage(path) };
}

export function bashToolPayload(item: PhoneUiToolMessage) {
  const details = asRecord(item.details);
  const command = String(item.command || item.args?.command || item.title?.replace(/^bash\s*·\s*/, '') || item.title || 'bash').trim();
  const argsText = JSON.stringify(item.args || {}, null, 2);
  const outputText = item.status === 'running' && item.text === argsText ? '' : item.text || '';
  return {
    command,
    outputText,
    timeout: typeof item.args?.timeout === 'number' ? item.args.timeout : undefined,
    fullOutputPath: typeof details?.fullOutputPath === 'string' ? details.fullOutputPath : '',
  };
}

function buildEditPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const details = asRecord(item.details);
  const path = getToolPath(item);
  if (!path) return applyFallback(preview, item);

  const diffLines = typeof details?.diff === 'string'
    ? parseNumberedDiffLines(details.diff)
    : buildEditPreviewLines(String(item.args?.oldText || ''), String(item.args?.newText || ''));
  const stats = computeDiffStats(diffLines);
  preview.eyebrow = item.live ? 'Editing file' : 'Edit diff';
  preview.subject = path;
  preview.artifact = true;
  preview.defaultOpen = true;
  preview.badges = [];
  if (stats.added) preview.badges.push({ label: `+${stats.added}`, variant: 'added' });
  if (stats.removed) preview.badges.push({ label: `-${stats.removed}`, variant: 'removed' });
  if (!stats.added && !stats.removed) preview.badges.push({ label: item.live ? 'editing' : 'updated', variant: 'neutral' });
  if (typeof details?.firstChangedLine === 'number') preview.badges.push({ label: `L${details.firstChangedLine}`, variant: 'neutral' });
  if (typeof details?.diff !== 'string') preview.note = 'Preview from the requested replacement block.';
  if (diffLines.length) preview.sections.push(limitedDiffSection(diffLines, item.live ? 120 : 80));
  return applyFallback(preview, item);
}

function buildWritePreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const path = getToolPath(item);
  const content = typeof item.args?.content === 'string' ? item.args.content : '';
  if (!path || !content) return applyFallback(preview, item);

  const lineCount = countTextLines(content);
  const byteCount = typeof TextEncoder === 'function' ? new TextEncoder().encode(content).length : content.length;
  const languageLabel = detectLanguageLabel(path);
  preview.eyebrow = item.live ? 'Writing file' : 'File preview';
  preview.subject = path;
  preview.artifact = true;
  preview.defaultOpen = Boolean(item.live) || lineCount <= 14;
  preview.note = 'Preview from the content sent to write.';
  preview.badges = [];
  if (lineCount) preview.badges.push({ label: `${lineCount} line${lineCount === 1 ? '' : 's'}` });
  if (byteCount) preview.badges.push({ label: formatBytes(byteCount) });
  if (languageLabel) preview.badges.push({ label: languageLabel, variant: 'accent' });
  preview.sections.push(codePreviewSection(content, { limit: item.live ? 30 : 24, lang: detectSupportedLanguage(path) }));
  return preview;
}

function buildReadPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const path = getToolPath(item);
  if (!path) return applyFallback(preview, item);

  const text = item.text || '';
  const imageSrc = firstImageSource(item.rawContent);
  const languageLabel = detectLanguageLabel(path);
  const startLine = Number.isFinite(Number(item.args?.offset)) && Number(item.args?.offset) > 0 ? Number(item.args?.offset) : 1;
  const { body } = splitToolNotice(text);
  const visibleLineCount = countTextLines(body);
  const rangeLabel = summarizeRange(startLine, visibleLineCount);

  preview.eyebrow = item.live ? 'Reading file' : 'Read result';
  preview.subject = path;
  preview.artifact = true;
  preview.defaultOpen = Boolean(imageSrc) || isMarkdownPath(path) || visibleLineCount <= 14;
  preview.badges = [];
  if (rangeLabel) preview.badges.push({ label: rangeLabel });
  if (languageLabel) preview.badges.push({ label: languageLabel, variant: 'accent' });
  if (imageSrc) preview.badges.push({ label: 'image', variant: 'accent' });

  if (imageSrc) preview.sections.push({ type: 'image', src: imageSrc, alt: path });
  else if (isMarkdownPath(path)) preview.sections.push(markdownPreviewSection(text, { limit: 90 }));
  else {
    preview.sections.push(
      codePreviewSection(text, {
        limit: item.live ? 60 : 32,
        startLine,
        emptyLabel: 'No readable text returned.',
        lang: detectSupportedLanguage(path),
      }),
    );
  }
  return preview;
}

function buildBashPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const details = asRecord(item.details);
  const command = String(item.command || item.args?.command || item.title?.replace(/^bash\s*·\s*/, '') || item.title || 'bash').trim();
  preview.eyebrow = item.live ? 'Shell command running' : 'Shell command';
  preview.subject = command;
  preview.defaultOpen = true;
  preview.badges = [];
  if (item.status === 'running' || item.live) preview.badges.push({ label: 'running', variant: 'accent' });
  else if (item.status === 'error') preview.badges.push({ label: 'failed', variant: 'removed' });
  else if (item.status === 'cancelled') preview.badges.push({ label: 'cancelled', variant: 'neutral' });
  else preview.badges.push({ label: 'done', variant: 'added' });
  if (typeof item.args?.timeout === 'number') preview.badges.push({ label: `${item.args.timeout}s timeout` });
  if (details?.fullOutputPath) preview.badges.push({ label: 'full log saved' });
  if (typeof details?.fullOutputPath === 'string') preview.note = `Full output: ${details.fullOutputPath}`;

  const argsText = JSON.stringify(item.args || {}, null, 2);
  const outputText = item.status === 'running' && item.text === argsText ? '' : item.text || '';
  preview.sections.push(terminalPreviewSection(outputText, { limit: item.live ? 140 : 100, lang: 'bash' }));
  return preview;
}

function buildGrepToolPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const pattern = typeof item.args?.pattern === 'string' ? item.args.pattern : '';
  const searchPath = typeof item.args?.path === 'string' && item.args.path.trim() ? item.args.path : '.';
  const section = buildGrepPreview(item.text || '', { limitFiles: 10, limitLinesPerFile: 8 });
  preview.eyebrow = item.live ? 'Searching files' : 'Search results';
  preview.subject = searchPath;
  preview.defaultOpen = section.matchCount > 0 || Boolean(item.live);
  preview.badges = [];
  if (pattern) preview.badges.push({ label: pattern.length > 28 ? `${pattern.slice(0, 27)}…` : pattern, variant: 'accent' });
  if (section.matchCount) preview.badges.push({ label: `${section.matchCount} match${section.matchCount === 1 ? '' : 'es'}` });
  if (section.fileCount) preview.badges.push({ label: `${section.fileCount} file${section.fileCount === 1 ? '' : 's'}` });
  preview.sections.push(section);
  return preview;
}

function buildFindPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const { entries, notice } = parseListEntries(item.text || '');
  const searchPath = typeof item.args?.path === 'string' && item.args.path.trim() ? item.args.path : '.';
  preview.eyebrow = item.live ? 'Finding paths' : 'Find results';
  preview.subject = searchPath;
  preview.defaultOpen = entries.length <= 16 || Boolean(item.live);
  preview.badges = [];
  if (typeof item.args?.pattern === 'string') preview.badges.push({ label: item.args.pattern, variant: 'accent' });
  if (entries.length) preview.badges.push({ label: `${entries.length} result${entries.length === 1 ? '' : 's'}` });
  preview.sections.push(listPreviewSection(entries, { limit: 60, notice }));
  return preview;
}

function buildLsPreview(item: PhoneUiToolMessage): ToolRichPreview {
  const preview = basePreview(item);
  const { entries, notice } = parseListEntries(item.text || '');
  const listPath = typeof item.args?.path === 'string' && item.args.path.trim() ? item.args.path : '.';
  const dirCount = entries.filter((entry) => entry.endsWith('/')).length;
  preview.eyebrow = item.live ? 'Listing directory' : 'Directory listing';
  preview.subject = listPath;
  preview.defaultOpen = entries.length <= 20 || Boolean(item.live);
  preview.badges = [];
  if (entries.length) preview.badges.push({ label: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` });
  if (dirCount) preview.badges.push({ label: `${dirCount} dir${dirCount === 1 ? '' : 's'}`, variant: 'accent' });
  preview.sections.push(listPreviewSection(entries, { limit: 80, notice }));
  return preview;
}

export type ToolPreviewOptions = {
  panelOpen?: ReadonlyMap<string, boolean> | null;
};

export function isToolPanelOpen(itemId: string, defaultOpen = false, panelOpen?: ReadonlyMap<string, boolean> | null) {
  if (panelOpen?.has(itemId)) return Boolean(panelOpen.get(itemId));
  return defaultOpen;
}

function applyPanelOpen(preview: ToolRichPreview, options?: ToolPreviewOptions) {
  preview.open = isToolPanelOpen(preview.panelKey, preview.defaultOpen, options?.panelOpen);
  return preview;
}

export function buildToolPreview(item: PhoneUiToolMessage, options?: ToolPreviewOptions): ToolRichPreview {
  const toolName = normalizedToolName(item.toolName || item.title || '');
  let preview: ToolRichPreview;
  if (toolName === 'edit') preview = buildEditPreview(item);
  else if (toolName === 'write') preview = buildWritePreview(item);
  else if (toolName === 'read') preview = buildReadPreview(item);
  else if (toolName === 'bash') preview = buildBashPreview(item);
  else if (toolName === 'grep') preview = buildGrepToolPreview(item);
  else if (toolName === 'find') preview = buildFindPreview(item);
  else if (toolName === 'ls') preview = buildLsPreview(item);
  else preview = applyFallback(basePreview(item), item);
  return applyPanelOpen(preview, options);
}

export const normalizeToolPreview = buildToolPreview;
