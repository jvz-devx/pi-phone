import type {
  PhoneAppState,
} from '$lib/stores/pi-phone-state';
import type { PhoneSavedSession, PhoneSessionSummary, PhoneTree, PhoneTreeNode } from '$lib/types/pi-phone';

export type ActiveSessionGroup = {
  kind: 'parent' | 'parallel';
  title: string;
  description: string;
  sessions: PhoneSessionSummary[];
};

export type SavedSessionGroup = {
  key: string;
  title: string;
  description: string;
  parentPath: string | null;
  sessions: PhoneSavedSession[];
};

export type TreeListNode = PhoneTreeNode & {
  isCurrent: boolean;
  isOnActivePath: boolean;
  isBranchPoint: boolean;
  timestampLabel: string;
  primaryLabel: string;
  roleLabel: string;
  modelLabel: string;
  preview: string;
};

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (value == null || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function compactPathLabel(path: string | null | undefined, fallback = 'Session') {
  const value = String(path || '').trim();
  if (!value) return fallback;
  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || value || fallback;
}

export function savedSessionTitle(session: PhoneSavedSession) {
  return session.name || session.firstMessage || session.id || compactPathLabel(session.path, 'Session');
}

export function savedSessionSubtitle(session: PhoneSavedSession) {
  return [formatDateTime(session.modified), Number.isFinite(session.messageCount) ? `${session.messageCount} messages` : '', session.cwd]
    .filter(Boolean)
    .join(' · ');
}

export function savedSessionPreview(session: PhoneSavedSession) {
  return session.firstMessage || session.name || '';
}

export function savedSessionForkEntryId(session: PhoneSavedSession) {
  const record = session as PhoneSavedSession & {
    forkEntryId?: unknown;
    branchEntryId?: unknown;
    leafEntryId?: unknown;
    currentLeafId?: unknown;
  };
  const entryId = record.forkEntryId ?? record.branchEntryId ?? record.leafEntryId ?? record.currentLeafId;
  return typeof entryId === 'string' && entryId.trim() ? entryId.trim() : null;
}

export function groupSavedSessions(sessions: PhoneSavedSession[]) {
  const byPath = new Map(sessions.map((session) => [session.path, session]));
  const roots: PhoneSavedSession[] = [];
  const children = new Map<string, PhoneSavedSession[]>();

  for (const session of sessions) {
    const parentPath = typeof session.parentSessionPath === 'string' && session.parentSessionPath ? session.parentSessionPath : null;
    if (!parentPath) roots.push(session);
    else children.set(parentPath, [...(children.get(parentPath) || []), session]);
  }

  const sortSaved = (left: PhoneSavedSession, right: PhoneSavedSession) => {
    const leftTime = new Date(left.modified || left.created || 0).getTime() || 0;
    const rightTime = new Date(right.modified || right.created || 0).getTime() || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return savedSessionTitle(left).localeCompare(savedSessionTitle(right));
  };

  const groups: SavedSessionGroup[] = [];
  if (roots.length || !sessions.length) {
    groups.push({
      key: 'root',
      title: 'Parent sessions',
      description: 'Saved sessions for the current working directory.',
      parentPath: null,
      sessions: [...roots].sort(sortSaved),
    });
  }

  for (const [parentPath, groupSessions] of [...children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const parent = byPath.get(parentPath);
    groups.push({
      key: parentPath,
      title: parent ? `Parallel from ${savedSessionTitle(parent)}` : `Parallel from ${compactPathLabel(parentPath)}`,
      description: parentPath,
      parentPath,
      sessions: [...groupSessions].sort(sortSaved),
    });
  }

  return groups;
}

export function sortActiveSessions(state: PhoneAppState) {
  const selectedId = activeSessionId(state);
  return [...state.sessions.active].sort((left, right) => {
    const leftCurrent = left.id === selectedId ? 1 : 0;
    const rightCurrent = right.id === selectedId ? 1 : 0;
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;

    const leftPending = left.hasPendingUiRequest ? 1 : 0;
    const rightPending = right.hasPendingUiRequest ? 1 : 0;
    if (leftPending !== rightPending) return rightPending - leftPending;

    const leftLive = left.isStreaming ? 1 : 0;
    const rightLive = right.isStreaming ? 1 : 0;
    if (leftLive !== rightLive) return rightLive - leftLive;

    return activeSessionLabel(left).localeCompare(activeSessionLabel(right));
  });
}

export function groupActiveSessions(state: PhoneAppState): ActiveSessionGroup[] {
  const sessions = sortActiveSessions(state);
  return [
    {
      kind: 'parent',
      title: 'Parent',
      description: 'Mirrors the CLI session and owns parent-only command controls.',
      sessions: sessions.filter((session) => session.kind === 'parent'),
    },
    {
      kind: 'parallel',
      title: 'Parallel',
      description: 'Independent phone workers for side quests and follow-ups.',
      sessions: sessions.filter((session) => session.kind === 'parallel'),
    },
  ];
}

export function activeSessionId(state: PhoneAppState) {
  return state.sessions.activeSessionId || state.snapshot.workerId || state.status?.sessionWorkerId || null;
}

export function activeSessionLabel(session: PhoneSessionSummary) {
  return session.label || session.sessionName || session.sessionId || session.id || 'Session';
}

export function activeSessionPreview(session: PhoneSessionSummary) {
  return session.lastUserPreview || session.firstUserPreview || '';
}

export function activeSessionStatusBits(session: PhoneSessionSummary, state: PhoneAppState) {
  const selectedId = activeSessionId(state);
  return [
    session.id === selectedId ? 'current' : '',
    session.kind === 'parent' ? (session.mirrorsCli === false ? 'parent' : 'mirroring cli') : 'parallel',
    session.isStreaming ? 'live' : '',
    session.isCompacting ? 'compacting' : '',
    session.hasPendingUiRequest ? 'needs input' : '',
    session.kind === 'parent' && session.commandContextAvailable === false ? 'command controls unavailable' : '',
    session.model?.name || session.model?.id || '',
    Number.isFinite(session.messageCount) ? `${session.messageCount} messages` : '',
    session.pendingMessageCount ? `${session.pendingMessageCount} pending` : '',
    session.secondaryLabel || '',
  ].filter(Boolean);
}

export function treeFileLabel(tree: PhoneTree | null | undefined) {
  return compactPathLabel(tree?.sessionFile, 'Current session file');
}

export function mapTreeNodes(tree: PhoneTree | null | undefined): TreeListNode[] {
  if (!tree) return [];
  const pathIds = new Set(tree.currentPathIds || []);
  return (tree.nodes || []).map((node) => {
    const isCurrent = tree.currentLeafId === node.id;
    const isOnActivePath = pathIds.has(node.id);
    const modelLabel = node.type === 'model_change' ? node.summary?.preview || '' : '';
    const roleLabel = node.summary?.role || '';
    return {
      ...node,
      isCurrent,
      isOnActivePath,
      isBranchPoint: Number(node.childCount || 0) > 1,
      timestampLabel: formatDateTime(node.timestamp),
      primaryLabel: node.summary?.kind || node.type || 'entry',
      roleLabel,
      modelLabel,
      preview: node.summary?.preview || '(empty)',
    };
  });
}
