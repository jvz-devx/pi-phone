<script lang="ts">
  import { onMount } from 'svelte';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import { Button } from '$lib/components/ui/button/index.js';
  import { phoneClient } from '$lib/pi-phone-transport';
  import type { PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import type { PhoneAutocompleteClient } from '$lib/actions/autocomplete';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSheetMode } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';
  import ChatWorkspace from '$lib/components/chat/ChatWorkspace.svelte';
  import ComposerBar from '$lib/components/chat/ComposerBar.svelte';
  import InspectorPanel from './InspectorPanel.svelte';
  import SessionRail from './SessionRail.svelte';
  import TopStatusBar from './TopStatusBar.svelte';
  import SheetBrowser from '$lib/components/sheets/SheetBrowser.svelte';

  const LEFT_PREF_KEY = 'pi-phone-shell-left-open';
  const RIGHT_PREF_KEY = 'pi-phone-shell-right-open';

  type MobilePanel = 'inspector' | 'actions' | PhoneSheetMode | null;

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient & PhoneAutocompleteClient;
    class?: string;
    fixtureMode?: boolean;
    onOpenLogin?: () => void;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', fixtureMode = false, onOpenLogin }: Props = $props();

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let mobilePanel = $state<MobilePanel>(null);
  let mounted = $state(false);
  let appState = $derived($stateStore);
  let activeSession = $derived(appState.sessions.active.find((session) => session.id === appState.sessions.activeSessionId) || null);
  let desktopColumns = $derived(`${leftOpen ? 'minmax(15rem, 19rem)' : '0rem'} minmax(0, 1fr) ${rightOpen ? 'minmax(18rem, 22rem)' : '0rem'}`);
  let activePanel = $derived(appState.sheets.open ? appState.sheets.mode : mobilePanel);
  let lastQuotaRequestKey = $state('');

  function readBooleanPreference(key: string, fallback = false) {
    if (typeof localStorage === 'undefined') return fallback;
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value === '1';
  }

  function writeBooleanPreference(key: string, value: boolean) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value ? '1' : '0');
  }

  function setLeftOpen(open: boolean) {
    leftOpen = open;
    if (mounted) writeBooleanPreference(LEFT_PREF_KEY, open);
  }

  function setRightOpen(open: boolean) {
    rightOpen = open;
    if (mounted) writeBooleanPreference(RIGHT_PREF_KEY, open);
  }

  function isDesktopLayout() {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  }

  function toggleLeft() {
    setLeftOpen(!leftOpen);
  }

  function toggleRight() {
    setRightOpen(!rightOpen);
  }

  function openMobilePanel(panel: Exclude<MobilePanel, null> | 'sessions') {
    const nextPanel = panel === 'sessions' ? 'active-sessions' : panel;
    mobilePanel = nextPanel;
    if (nextPanel !== 'inspector' && nextPanel !== 'actions') stateStore.setSheetMode(nextPanel, { open: true });
  }

  function closeMobilePanel() {
    mobilePanel = null;
    if (appState.sheets.open) stateStore.setSheetOpen(false);
  }

  function openActions() {
    stateStore.setSheetMode('actions', { open: true });
    if (isDesktopLayout()) {
      setRightOpen(true);
      mobilePanel = null;
      return;
    }

    mobilePanel = 'actions';
  }

  function requestRefresh(forceQuota = false) {
    client.refreshAll({ forceQuota });
    stateStore.update((state) => {
      state.connection.refreshRequested = true;
      state.connection.refreshRequestId += 1;
      state.quota.refreshNeeded = true;
      state.quota.forceRefresh = state.quota.forceRefresh || forceQuota;
      return state;
    });
  }

  function drawerTitle(panel: Exclude<MobilePanel, null>) {
    if (panel === 'inspector') return 'Inspector';
    if (panel === 'active-sessions') return 'Active sessions';
    if (panel === 'sessions') return 'Saved sessions';
    if (panel === 'actions') return 'Actions';
    return panel.replace(/(^|-)([a-z])/g, (_, prefix: string, char: string) => `${prefix ? ' ' : ''}${char.toUpperCase()}`);
  }

  $effect(() => {
    if (appState.sheets.open && isDesktopLayout() && !rightOpen) setRightOpen(true);
  });

  $effect(() => {
    const shouldRefreshQuota = appState.quota.refreshNeeded || appState.connection.forceQuotaRefreshRequested;
    if (!shouldRefreshQuota) {
      lastQuotaRequestKey = '';
      return;
    }

    const model = appState.snapshot.state?.model || activeSession?.model || null;
    const force = Boolean(appState.quota.forceRefresh || appState.connection.forceQuotaRefreshRequested);
    const key = `${model?.provider || ''}/${model?.id || ''}:${force ? 'force' : 'normal'}`;
    if (key === lastQuotaRequestKey) return;

    lastQuotaRequestKey = key;
    void client.refreshQuota({ model, force });
  });

  onMount(() => {
    leftOpen = readBooleanPreference(LEFT_PREF_KEY, false);
    rightOpen = readBooleanPreference(RIGHT_PREF_KEY, false);
    mounted = true;
  });
</script>

<div class={cn('phone-app-shell flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background/30 text-foreground', className)}>
  <TopStatusBar
    stateStore={stateStore}
    {leftOpen}
    {rightOpen}
    onToggleLeft={toggleLeft}
    onToggleRight={toggleRight}
    onOpenMobilePanel={(panel) => (panel === 'actions' ? openActions() : openMobilePanel(panel))}
    onRefresh={() => requestRefresh(true)}
    onOpenLogin={onOpenLogin}
  />

  <main class="mx-auto grid w-full max-w-[1440px] min-h-0 flex-1 gap-3 p-2 sm:p-3 lg:grid lg:p-4" style:grid-template-columns={desktopColumns}>
    <aside
      class={cn(
        'hidden min-h-0 overflow-hidden transition-[opacity,transform] duration-200 lg:flex',
        leftOpen ? 'opacity-100' : 'pointer-events-none -translate-x-2 opacity-0',
      )}
      aria-hidden={!leftOpen}
      aria-label="Session rail"
    >
      <SessionRail stateStore={stateStore} {client} class="w-full backdrop-blur" />
    </aside>

    <section class="flex min-h-0 min-w-0 flex-col gap-3" aria-label="Chat workspace">
      {#if fixtureMode}
        <div class="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary">
          Fixture mode is rendering local adapter data without connecting to a Pi Phone runtime.
        </div>
      {/if}
      <ChatWorkspace class="min-h-0 flex-1" stateStore={stateStore} bottomReserve={16} />
      <ComposerBar class="shrink-0" stateStore={stateStore} {client} />
    </section>

    <aside
      class={cn(
        'hidden min-h-0 overflow-hidden transition-[opacity,transform] duration-200 lg:block',
        rightOpen ? 'opacity-100' : 'pointer-events-none translate-x-2 opacity-0',
      )}
      aria-hidden={!rightOpen}
      aria-label="Inspector column"
    >
      <div class="flex h-full min-h-0 flex-col gap-3">
        <div class="flex items-center justify-between rounded-3xl border bg-card/82 px-4 py-3 shadow-xl backdrop-blur">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{appState.sheets.open ? 'Pi browser' : 'Inspector'}</p>
            <h2 class="text-base font-semibold">{appState.sheets.open ? drawerTitle(appState.sheets.mode) : 'Context and details'}</h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse inspector" onclick={toggleRight}>
            <PanelRightClose class="size-4" aria-hidden="true" />
          </Button>
        </div>
        {#if appState.sheets.open}
          <SheetBrowser stateStore={stateStore} {client} class="min-h-0 flex-1 overflow-y-auto" />
        {:else}
          <InspectorPanel stateStore={stateStore} {client} class="min-h-0 flex-1 overflow-y-auto" />
        {/if}
      </div>
    </aside>
  </main>

  {#if activePanel}
    <div class="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" role="presentation" onclick={(event) => event.currentTarget === event.target && closeMobilePanel()}>
      <section class="absolute inset-x-0 bottom-0 max-h-[86dvh] rounded-t-3xl border bg-card p-3 shadow-2xl" aria-label={drawerTitle(activePanel)}>
        <div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true"></div>
        <div class="flex items-center justify-between gap-2 border-b pb-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pi control center</p>
            <h2 class="text-lg font-semibold">{drawerTitle(activePanel)}</h2>
          </div>
          <Button type="button" variant="outline" size="sm" onclick={closeMobilePanel}>Close</Button>
        </div>

        <div class="max-h-[68dvh] overflow-y-auto pt-3">
          {#if activePanel === 'inspector'}
            <InspectorPanel stateStore={stateStore} {client} class="border-0 bg-transparent p-0 shadow-none" />
          {:else}
            <SheetBrowser stateStore={stateStore} {client} mode={activePanel} showHeader={false} compact />
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>
