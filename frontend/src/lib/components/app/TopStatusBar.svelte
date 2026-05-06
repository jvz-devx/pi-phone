<script lang="ts">
  import Activity from '@lucide/svelte/icons/activity';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Bot from '@lucide/svelte/icons/bot';
  import Gauge from '@lucide/svelte/icons/gauge';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Server from '@lucide/svelte/icons/server';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import { Button } from '$lib/components/ui/button/index.js';
  import { piPhoneState, type PhoneAppState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    class?: string;
    leftOpen?: boolean;
    rightOpen?: boolean;
    onToggleLeft?: () => void;
    onToggleRight?: () => void;
    onOpenMobilePanel?: (panel: 'sessions' | 'inspector' | 'actions') => void;
    onRefresh?: () => void;
    onOpenLogin?: () => void;
  }

  let {
    stateStore = piPhoneState,
    class: className = '',
    leftOpen = false,
    rightOpen = false,
    onToggleLeft,
    onToggleRight,
    onOpenMobilePanel,
    onRefresh,
    onOpenLogin,
  }: Props = $props();

  let appState = $derived($stateStore);
  let status = $derived(appState.status || appState.auth.health);
  let snapshotMatchesActive = $derived(
    !appState.snapshot.workerId || !appState.sessions.activeSessionId || appState.snapshot.workerId === appState.sessions.activeSessionId,
  );
  let snapshot = $derived(snapshotMatchesActive ? appState.snapshot.state : null);
  let activeSession = $derived(appState.sessions.active.find((session) => session.id === appState.sessions.activeSessionId) || null);
  let connectionLabel = $derived(connectionStateLabel(appState));
  let connectionTone = $derived(connectionToneClass(appState));
  let cwd = $derived((status?.cwd || appState.auth.health?.cwd || '').trim());
  let sessionLabel = $derived(snapshot?.sessionName || snapshot?.sessionId || activeSession?.label || 'Current session');
  let modelLabel = $derived(snapshot?.model?.name || snapshot?.model?.id || activeSession?.model?.name || activeSession?.model?.id || 'Default');
  let thinkingLabel = $derived(snapshot?.thinkingLevel || '—');
  let owner = $derived(status?.controlOwner || appState.auth.health?.controlOwner || 'cli');
  let streaming = $derived(Boolean(status?.isStreaming || snapshot?.isStreaming));
  let compacting = $derived(Boolean(status?.isCompacting || snapshot?.isCompacting));
  let commandControlsUnavailable = $derived(
    Boolean((status as { sessionKind?: string; commandContextAvailable?: boolean } | null)?.sessionKind === 'parent' && status?.commandContextAvailable === false) ||
      snapshot?.commandContextAvailable === false ||
      activeSession?.commandContextAvailable === false,
  );
  let serverLabel = $derived(status?.port ? `${status.host || '127.0.0.1'}:${status.port}` : appState.auth.health?.port ? `${appState.auth.health.host || '127.0.0.1'}:${appState.auth.health.port}` : '—');
  let stateLabel = $derived(`${streaming ? 'Streaming' : compacting ? 'Compacting' : 'Idle'} · ${owner}${commandControlsUnavailable ? ' · controls unavailable' : ''}`);
  let banners = $derived(buildBanners(appState, commandControlsUnavailable));

  function connectionStateLabel(state: PhoneAppState) {
    if (state.connection.socketReadyState === 1 || state.connection.connectionState === 'open') return 'Connected';
    switch (state.connection.connectionState) {
      case 'health-loading':
        return 'Checking…';
      case 'auth-required':
        return 'Token required';
      case 'connecting':
        return 'Connecting…';
      case 'reconnecting':
        return 'Retrying…';
      case 'error':
        return 'Error';
      case 'closed':
        return 'Offline';
      default:
        return state.auth.health?.isRunning ? 'Ready' : 'Offline';
    }
  }

  function connectionToneClass(state: PhoneAppState) {
    if (state.connection.socketReadyState === 1 || state.connection.connectionState === 'open') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
    if (state.connection.connectionState === 'connecting' || state.connection.connectionState === 'health-loading' || state.connection.connectionState === 'reconnecting') {
      return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
    }
    if (state.connection.connectionState === 'auth-required' || state.connection.connectionState === 'error') return 'border-destructive/40 bg-destructive/10 text-destructive';
    return 'border-border bg-secondary/60 text-muted-foreground';
  }

  function buildBanners(state: PhoneAppState, controlsUnavailable: boolean) {
    const result: Array<{ text: string; kind: 'info' | 'error' | 'warning' | 'success'; key: string }> = [];
    const seen = new Set<string>();
    const push = (text: string | null | undefined, kind: 'info' | 'error' | 'warning' | 'success' = 'info', key = text || '') => {
      const clean = String(text || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      result.push({ text: clean, kind, key: key || clean });
    };

    push(state.feedback.banner?.text, state.feedback.banner?.kind, 'feedback');
    push(state.connection.banner?.text, state.connection.banner?.kind, 'connection');
    if (state.connection.connectionState === 'auth-required') push('Access token required. Enter the current /phone-start token.', 'error', 'auth-required');
    if (state.connection.connectionState === 'reconnecting' || state.connection.reconnectScheduled) push('Connection lost. Retrying…', 'warning', 'retry');
    if (state.connection.lastClose?.code === 4009) push('This Pi Phone instance was opened from another device or tab.', 'error', 'single-client');
    if (state.connection.lastClose?.code === 4010) push('Pi Phone stopped due to inactivity. Run /phone-start again when needed.', 'error', 'idle-timeout');
    if (controlsUnavailable) push('Parent session command controls are unavailable until Pi provides a fresh command context.', 'warning', 'command-context');
    push(state.auth.authError, 'error', 'auth');
    push(state.connection.lastError, 'error', 'transport-error');
    push(state.status?.lastError || state.auth.health?.lastError, 'error', 'server-error');
    return result;
  }

  function openSessions() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) onToggleLeft?.();
    else onOpenMobilePanel?.('sessions');
  }

  function openInspector() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) onToggleRight?.();
    else onOpenMobilePanel?.('inspector');
  }

  function openActions() {
    onOpenMobilePanel?.('actions');
  }
</script>

<header class={cn('phone-top-status shrink-0 border-b bg-background/78 px-3 py-2 backdrop-blur-xl sm:px-4', className)} aria-label="Pi Phone status">
  <div class="mx-auto flex w-full max-w-[1440px] flex-col gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold', connectionTone)}>
            <span class={cn('size-2 rounded-full', streaming ? 'animate-pulse bg-primary' : 'bg-current')} aria-hidden="true"></span>
            {connectionLabel}
          </span>
          <span class="truncate text-sm font-semibold sm:text-base">{sessionLabel}</span>
          {#if streaming}
            <span class="hidden rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary sm:inline-flex">Streaming</span>
          {/if}
        </div>
        <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:hidden">
          <span class="truncate">{modelLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{thinkingLabel}</span>
          {#if cwd}
            <span aria-hidden="true">·</span>
            <span class="truncate font-mono">{cwd}</span>
          {/if}
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <Button class="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open sessions panel" onclick={openSessions}>
          <PanelLeft class="size-4" aria-hidden="true" />
        </Button>
        <Button class="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open actions" onclick={openActions}>
          <SlidersHorizontal class="size-4" aria-hidden="true" />
        </Button>
        <Button class="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open inspector" onclick={openInspector}>
          <PanelRight class="size-4" aria-hidden="true" />
        </Button>

        <Button class="hidden gap-2 lg:inline-flex" type="button" variant={leftOpen ? 'secondary' : 'outline'} size="sm" aria-pressed={leftOpen} aria-label="Open sessions panel, shortcut S" title="Open sessions (S)" onclick={openSessions}>
          <PanelLeft class="size-4" aria-hidden="true" />
          Sessions <span class="text-[0.65rem] text-muted-foreground">S</span>
        </Button>
        <Button class="hidden gap-2 lg:inline-flex" type="button" variant="outline" size="sm" aria-label="Open actions panel" title="Open actions" onclick={openActions}>
          <SlidersHorizontal class="size-4" aria-hidden="true" />
          Actions
        </Button>
        <Button class="hidden gap-2 lg:inline-flex" type="button" variant={rightOpen ? 'secondary' : 'outline'} size="sm" aria-pressed={rightOpen} aria-label="Open inspector panel" title="Open inspector" onclick={openInspector}>
          <PanelRight class="size-4" aria-hidden="true" />
          Inspector
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Refresh Pi state" title="Refresh Pi state" onclick={onRefresh}>
          <RefreshCw class={cn('size-4', appState.connection.connectionState === 'health-loading' && 'animate-spin')} aria-hidden="true" />
        </Button>
        {#if appState.auth.loginOpen || appState.connection.connectionState === 'auth-required'}
          <Button type="button" variant="default" size="sm" onclick={onOpenLogin}>Token</Button>
        {/if}
      </div>
    </div>

    <div class="hidden min-w-0 grid-cols-2 gap-2 text-xs md:grid lg:grid-cols-6">
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="flex items-center gap-1.5 text-muted-foreground"><Terminal class="size-3.5" aria-hidden="true" /> CWD</div>
        <div class="mt-1 truncate font-mono" title={cwd}>{cwd || '—'}</div>
      </div>
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="flex items-center gap-1.5 text-muted-foreground"><Bot class="size-3.5" aria-hidden="true" /> Model</div>
        <div class="mt-1 truncate" title={modelLabel}>{modelLabel}</div>
      </div>
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="flex items-center gap-1.5 text-muted-foreground"><Gauge class="size-3.5" aria-hidden="true" /> Thinking</div>
        <div class="mt-1 truncate">{thinkingLabel}</div>
      </div>
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="flex items-center gap-1.5 text-muted-foreground"><Activity class="size-3.5" aria-hidden="true" /> State</div>
        <div class={cn('mt-1 truncate', commandControlsUnavailable && 'text-amber-100')}>{stateLabel}</div>
      </div>
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="flex items-center gap-1.5 text-muted-foreground"><Server class="size-3.5" aria-hidden="true" /> Server</div>
        <div class="mt-1 truncate font-mono">{serverLabel}</div>
      </div>
      <div class="rounded-2xl border bg-secondary/35 px-3 py-2">
        <div class="text-muted-foreground">Clients</div>
        <div class="mt-1 truncate">{status?.connectedClients ?? appState.auth.health?.connectedClients ?? 0} connected</div>
      </div>
    </div>

    <p class="sr-only">Desktop shortcuts: C opens commands, S opens sessions, J jumps to latest, period stops a running response, Enter sends from the composer.</p>

    {#if banners.length}
      <div class="grid gap-1.5" aria-live="polite">
        {#each banners as banner (banner.key)}
          <div
            class={cn(
              'flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs sm:text-sm',
              banner.kind === 'error'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : banner.kind === 'warning'
                  ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                  : 'border-primary/25 bg-primary/10 text-primary',
            )}
          >
            <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{banner.text}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</header>
