import type { PhoneContextUsage, PhoneModel, PhoneQuotaResponse, PhoneQuotaWindow, PhoneSnapshotState } from '$lib/types/pi-phone';

export type PhoneQuotaContextModelRef = {
  provider?: PhoneModel['provider'] | null;
  id?: PhoneModel['id'] | null;
  modelId?: string | null;
  contextWindow?: number | null;
  [key: string]: unknown;
};

export type PhoneDisplayContextUsage = PhoneContextUsage & { text: string };

export type PhoneQuotaContextDisplay = {
  cwd: string;
  contextUsage: PhoneDisplayContextUsage | null;
  quotaSupported: boolean;
  primary: PhoneQuotaWindow | null;
  secondary: PhoneQuotaWindow | null;
  visible: boolean;
};

export function normalizeQuotaModel(model: PhoneQuotaContextModelRef | null | undefined) {
  if (!model || typeof model !== 'object') return null;
  const provider = typeof model.provider === 'string' ? model.provider : '';
  const modelId =
    typeof model.id === 'string'
      ? model.id
      : typeof model.modelId === 'string'
        ? model.modelId
        : '';
  if (!provider && !modelId) return null;
  return { provider, modelId };
}

export function supportsPiQuotaForModel(model: PhoneQuotaContextModelRef | null | undefined) {
  const current = normalizeQuotaModel(model);
  return Boolean(current && current.provider === 'openai-codex' && /^gpt-/i.test(current.modelId || ''));
}

export function formatTokenCount(count: number) {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count < 1000) return String(Math.round(count));
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function snapshotContextUsage(snapshot: PhoneSnapshotState | null | undefined): PhoneDisplayContextUsage | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const contextWindow = Number(snapshot.contextUsage?.contextWindow ?? snapshot.model?.contextWindow);
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  const percent = typeof snapshot.contextUsage?.percent === 'number' ? snapshot.contextUsage.percent : null;
  const percentDisplay = percent === null ? '?' : `${percent.toFixed(1)}%`;
  return {
    tokens: snapshot.contextUsage?.tokens ?? null,
    contextWindow,
    percent,
    text: `${percentDisplay}/${formatTokenCount(contextWindow)}`,
  };
}

export function quotaContextDisplay(input: {
  cwd?: string | null;
  snapshot?: PhoneSnapshotState | null;
  quota?: PhoneQuotaResponse | null;
}): PhoneQuotaContextDisplay {
  const cwd = String(input.cwd || '').trim();
  const contextUsage = snapshotContextUsage(input.snapshot);
  const quotaSupported = supportsPiQuotaForModel(input.snapshot?.model);
  const primary = quotaSupported ? input.quota?.primaryWindow || null : null;
  const secondary = quotaSupported ? input.quota?.secondaryWindow || null : null;
  return {
    cwd,
    contextUsage,
    quotaSupported,
    primary,
    secondary,
    visible: Boolean(cwd || contextUsage || primary || secondary),
  };
}
