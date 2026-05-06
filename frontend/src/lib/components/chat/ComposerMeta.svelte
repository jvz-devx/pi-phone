<script lang="ts">
  import { quotaContextDisplay, type PhoneDisplayContextUsage } from '$lib/adapters/quota-context';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneQuotaWindow } from '$lib/types/pi-phone';
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
  let display = $derived(quotaContextDisplay({ cwd, snapshot: appState.snapshot.state, quota: appState.quota.value }));
  let contextUsage = $derived(display.contextUsage);
  let primary = $derived(display.primary);
  let secondary = $derived(display.secondary);
  let visible = $derived(display.visible);

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

  function quotaTone(window: PhoneQuotaWindow | null) {
    const leftPercent = window?.leftPercent;
    if (!Number.isFinite(leftPercent)) return 'border-border/60 bg-secondary/45 text-muted-foreground';
    if ((leftPercent || 0) <= 10) return 'border-destructive/40 bg-destructive/10 text-destructive';
    if ((leftPercent || 0) <= 25) return 'border-amber-400/40 bg-amber-500/10 text-amber-200';
    return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  }

  function contextTone(context: PhoneDisplayContextUsage | null) {
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
