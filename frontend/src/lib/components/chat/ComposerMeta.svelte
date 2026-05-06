<script lang="ts">
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneContextUsage, PhoneModel, PhoneQuotaWindow, PhoneSnapshotState } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    class?: string;
    compact?: boolean;
  }

  let { stateStore = piPhoneState, class: className = '', compact = false }: Props = $props();

  let appState = $derived($stateStore);
  let cwd = $derived(appState.status?.cwd || appState.auth.health?.cwd || '');
  let cwdDisplay = $derived(formatCwdDisplay(cwd));
  let contextUsage = $derived(currentContextUsage(appState.snapshot.state));
  let quotaSupported = $derived(shouldShowQuotaForModel(appState.snapshot.state?.model));
  let primary = $derived(quotaSupported ? appState.quota.value?.primaryWindow || null : null);
  let secondary = $derived(quotaSupported ? appState.quota.value?.secondaryWindow || null : null);
  let visible = $derived(Boolean(cwd || contextUsage || primary || secondary));

  function formatCwdDisplay(path = '') {
    const value = String(path || '').trim();
    if (!value) return '';

    const homeMatch = value.match(/^\/(?:home|Users)\/[^/]+(\/.*)?$/);
    if (homeMatch) {
      const suffix = homeMatch[1] || '';
      const parts = suffix.split('/').filter(Boolean);
      if (!parts.length) return '~';
      if (parts.length === 1) return `~/${parts[0]}`;
      return `~/…/${parts[parts.length - 1]}`;
    }

    if (value === '/') return value;
    const parts = value.split('/').filter(Boolean);
    if (parts.length <= 2) return value;
    return `/…/${parts[parts.length - 1]}`;
  }

  function formatTokenCount(count: number) {
    if (!Number.isFinite(count) || count <= 0) return '';
    if (count < 1000) return String(Math.round(count));
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
  }

  function currentContextUsage(snapshot: PhoneSnapshotState | null): (PhoneContextUsage & { text: string }) | null {
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

  function shouldShowQuotaForModel(model: PhoneModel | null | undefined) {
    if (!model) return false;
    return model.provider === 'openai-codex' && /^gpt-/i.test(model.id || '');
  }

  function quotaTone(window: PhoneQuotaWindow | null) {
    const leftPercent = window?.leftPercent;
    if (!Number.isFinite(leftPercent)) return 'border-border/60 bg-secondary/45 text-muted-foreground';
    if ((leftPercent || 0) <= 10) return 'border-destructive/40 bg-destructive/10 text-destructive';
    if ((leftPercent || 0) <= 25) return 'border-amber-400/40 bg-amber-500/10 text-amber-200';
    return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  }

  function contextTone(context: (PhoneContextUsage & { text: string }) | null) {
    const percent = context?.percent;
    if (!Number.isFinite(percent)) return 'border-border/60 bg-secondary/45 text-muted-foreground';
    if ((percent || 0) > 90) return 'border-destructive/40 bg-destructive/10 text-destructive';
    if ((percent || 0) > 70) return 'border-amber-400/40 bg-amber-500/10 text-amber-200';
    return 'border-border/60 bg-secondary/45 text-muted-foreground';
  }
</script>

{#if visible}
  <div class={cn('flex flex-wrap items-center gap-2 text-[11px]', compact ? 'text-xs' : '', className)} aria-label="Composer status">
    {#if cwd}
      <span class="max-w-full truncate rounded-full border border-border/60 bg-secondary/45 px-2.5 py-1 font-mono text-muted-foreground" title={cwd} aria-label={`Working directory ${cwd}`}>
        {cwdDisplay}
      </span>
    {/if}
    {#if contextUsage}
      <span class={cn('rounded-full border px-2.5 py-1 font-mono', contextTone(contextUsage))} title="Current context usage" aria-label={`Current context usage ${contextUsage.text}`}>
        ctx {contextUsage.text}
      </span>
    {/if}
    {#if primary}
      <span class={cn('rounded-full border px-2.5 py-1 font-mono', quotaTone(primary))} title={`${primary.label} quota remaining`} aria-label={`${primary.label} quota remaining ${primary.text}`}>
        {primary.label} {primary.text}
      </span>
    {/if}
    {#if secondary}
      <span class={cn('rounded-full border px-2.5 py-1 font-mono', quotaTone(secondary))} title={`${secondary.label} quota remaining`} aria-label={`${secondary.label} quota remaining ${secondary.text}`}>
        {secondary.label} {secondary.text}
      </span>
    {/if}
  </div>
{/if}
