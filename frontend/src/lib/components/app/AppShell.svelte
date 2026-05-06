<script lang="ts">
  import { onMount, tick } from 'svelte';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import { Button } from '$lib/components/ui/button/index.js';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { abortGeneration, openPhoneSheet, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import type { PhoneAutocompleteClient } from '$lib/actions/autocomplete';
  import { computeViewportCssVars, reconcileMobilePanelForDesktop, type PhoneMobilePanel } from '$lib/actions/mobile-layout';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import { applyPiThemePayload } from '$lib/theme';
  import { cn } from '$lib/utils';
  import ChatWorkspace from '$lib/components/chat/ChatWorkspace.svelte';
  import ComposerBar from '$lib/components/chat/ComposerBar.svelte';
  import InspectorPanel from './InspectorPanel.svelte';
  import SessionRail from './SessionRail.svelte';
  import TopStatusBar from './TopStatusBar.svelte';
  import ExtensionUiDialog from './ExtensionUiDialog.svelte';
  import SheetBrowser from '$lib/components/sheets/SheetBrowser.svelte';

  const LEFT_PREF_KEY = 'pi-phone-shell-left-open';
  const RIGHT_PREF_KEY = 'pi-phone-shell-right-open';
  const JUMP_LATEST_EVENT = 'pi-phone:jump-latest';

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
  let mobilePanel = $state<PhoneMobilePanel>(null);
  let mounted = $state(false);
  let appState = $derived($stateStore);
  let activeSession = $derived(appState.sessions.active.find((session) => session.id === appState.sessions.activeSessionId) || null);
  let themePayload = $derived(appState.status?.theme || appState.auth.health?.theme || null);
  let rightPanelOpen = $derived(rightOpen || appState.sheets.open);
  let desktopColumns = $derived(`${leftOpen ? 'minmax(15rem, 19rem)' : '0rem'} minmax(0, 1fr) ${rightPanelOpen ? 'minmax(18rem, 22rem)' : '0rem'}`);
  let activePanel = $derived(appState.sheets.open ? appState.sheets.mode : mobilePanel);
  let lastQuotaRequestKey = $state('');
  let appliedThemeKey = $state('\0');
  let mobileSheetRef: HTMLElement | null = $state(null);
  let mobileCloseButton: HTMLButtonElement | null = $state(null);
  let previousActivePanel: PhoneMobilePanel = $state(null);
  let lastFocusedBeforeMobilePanel: HTMLElement | null = null;
  let streaming = $derived(Boolean(appState.status?.isStreaming || appState.snapshot.state?.isStreaming));

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

  function collapseRightPanel() {
    if (appState.sheets.open) stateStore.setSheetOpen(false);
    setRightOpen(false);
  }

  function toggleInspector() {
    if (appState.sheets.open) {
      stateStore.setSheetOpen(false);
      setRightOpen(true);
      return;
    }

    toggleRight();
  }

  function openMobilePanel(panel: Exclude<PhoneMobilePanel, null> | 'sessions') {
    const nextPanel = panel === 'sessions' ? 'active-sessions' : panel;
    mobilePanel = nextPanel;
    if (nextPanel !== 'inspector' && nextPanel !== 'actions') stateStore.setSheetMode(nextPanel, { open: true });
  }

  function closeMobilePanel() {
    mobilePanel = null;
    if (appState.sheets.open) stateStore.setSheetOpen(false);
    void tick().then(() => lastFocusedBeforeMobilePanel?.focus?.());
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

  function openCommandsFromShortcut() {
    if (!isDesktopLayout()) return;
    openPhoneSheet('commands', { store: stateStore, client });
    setRightOpen(true);
  }

  function openSessionsFromShortcut() {
    if (!isDesktopLayout()) return;
    setLeftOpen(true);
  }

  function jumpLatestFromShortcut() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(JUMP_LATEST_EVENT));
  }

  function stopFromShortcut() {
    if (!streaming) return;
    abortGeneration({ client, store: stateStore });
  }

  function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = (target as HTMLInputElement).type;
      return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
    }
    return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'));
  }

  function hasBlockingDialog() {
    return Boolean(appState.auth.loginOpen || appState.uiRequests.pending || activePanel);
  }

  function focusableMobileSheetElements() {
    if (!mobileSheetRef) return [];
    return [...mobileSheetRef.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null,
    );
  }

  function handleMobilePanelKeydown(event: KeyboardEvent) {
    if (!activePanel) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobilePanel();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = focusableMobileSheetElements();
    if (!focusable.length) {
      event.preventDefault();
      mobileSheetRef?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (activePanel && event.key === 'Escape') {
      event.preventDefault();
      closeMobilePanel();
      return;
    }
    if (!isDesktopLayout()) return;
    if (isEditableTarget(event.target) || hasBlockingDialog()) return;

    const key = event.key.toLowerCase();
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (key === 'c') {
      event.preventDefault();
      openCommandsFromShortcut();
      return;
    }

    if (key === 's') {
      event.preventDefault();
      openSessionsFromShortcut();
      return;
    }

    if (key === 'j') {
      event.preventDefault();
      jumpLatestFromShortcut();
      return;
    }

    if (key === '.' && streaming) {
      event.preventDefault();
      stopFromShortcut();
    }
  }

  function updateViewportVars() {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const { visualHeight, keyboardInset } = computeViewportCssVars(window.innerHeight, window.visualViewport);
    root.style.setProperty('--pi-visual-viewport-height', `${visualHeight}px`);
    root.style.setProperty('--pi-keyboard-inset', `${keyboardInset}px`);
    window.dispatchEvent(new CustomEvent('pi-phone:viewport-change', { detail: { visualHeight, keyboardInset } }));
  }

  function reconcileDesktopPanels() {
    if (!isDesktopLayout()) return;
    const transition = reconcileMobilePanelForDesktop(mobilePanel, appState.sheets.open);
    if (!transition) return;
    mobilePanel = transition.mobilePanel;
    if (transition.leftOpen !== undefined) setLeftOpen(transition.leftOpen);
    if (transition.rightOpen !== undefined) setRightOpen(transition.rightOpen);
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

  function drawerTitle(panel: Exclude<PhoneMobilePanel, null>) {
    if (panel === 'inspector') return 'Inspector';
    if (panel === 'active-sessions') return 'Active sessions';
    if (panel === 'sessions') return 'Saved sessions';
    if (panel === 'actions') return 'Actions';
    return panel.replace(/(^|-)([a-z])/g, (_, prefix: string, char: string) => `${prefix ? ' ' : ''}${char.toUpperCase()}`);
  }

  $effect(() => {
    const colors = themePayload?.colors || {};
    const key = `${themePayload?.name || ''}:${JSON.stringify(colors)}`;
    if (key === appliedThemeKey) return;
    appliedThemeKey = key;
    applyPiThemePayload(themePayload);
  });

  $effect(() => {
    const panel = activePanel;
    if (panel && !previousActivePanel && !isDesktopLayout()) {
      lastFocusedBeforeMobilePanel = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void tick().then(() => {
        mobileCloseButton?.focus?.();
        mobileSheetRef?.scrollTo?.({ top: 0 });
      });
    }
    previousActivePanel = panel;
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

    updateViewportVars();
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('resize', updateViewportVars);
    window.addEventListener('resize', reconcileDesktopPanels);
    window.visualViewport?.addEventListener('resize', updateViewportVars);
    window.visualViewport?.addEventListener('scroll', updateViewportVars);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('resize', updateViewportVars);
      window.removeEventListener('resize', reconcileDesktopPanels);
      window.visualViewport?.removeEventListener('resize', updateViewportVars);
      window.visualViewport?.removeEventListener('scroll', updateViewportVars);
      document.documentElement.style.removeProperty('--pi-visual-viewport-height');
      document.documentElement.style.removeProperty('--pi-keyboard-inset');
    };
  });
</script>

<div class={cn('phone-app-shell flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background/30 text-foreground', className)}>
  <TopStatusBar
    stateStore={stateStore}
    {leftOpen}
    rightOpen={rightOpen && !appState.sheets.open}
    onToggleLeft={toggleLeft}
    onToggleRight={toggleInspector}
    onOpenMobilePanel={(panel) => (panel === 'actions' ? openActions() : openMobilePanel(panel))}
    onRefresh={() => requestRefresh(true)}
    onOpenLogin={onOpenLogin}
  />

  <main class="phone-shell-main mx-auto grid w-full max-w-[1440px] min-h-0 flex-1 gap-3 p-2 sm:p-3 lg:grid lg:p-4" style:grid-template-columns={desktopColumns}>
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
        rightPanelOpen ? 'opacity-100' : 'pointer-events-none translate-x-2 opacity-0',
      )}
      aria-hidden={!rightPanelOpen}
      aria-label="Inspector panel"
    >
      <div class="flex h-full min-h-0 flex-col gap-3">
        <div class="flex items-center justify-between rounded-3xl border bg-card/82 px-4 py-3 shadow-sm backdrop-blur">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{appState.sheets.open ? 'Pi browser' : 'Inspector'}</p>
            <h2 class="text-base font-semibold">{appState.sheets.open ? drawerTitle(appState.sheets.mode) : 'Context and details'}</h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse inspector" onclick={collapseRightPanel}>
            <PanelRightClose class="size-4" aria-hidden="true" />
          </Button>
        </div>
        {#if appState.sheets.open}
          <SheetBrowser stateStore={stateStore} {client} class="min-h-0 flex-1 overflow-y-auto" onClose={collapseRightPanel} />
        {:else}
          <InspectorPanel stateStore={stateStore} {client} class="min-h-0 flex-1 overflow-y-auto" />
        {/if}
      </div>
    </aside>
  </main>

  <ExtensionUiDialog stateStore={stateStore} {client} />

  {#if activePanel}
    <div class="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" role="presentation" onclick={(event) => event.currentTarget === event.target && closeMobilePanel()} onkeydown={handleMobilePanelKeydown}>
      <div
        bind:this={mobileSheetRef}
        class="phone-mobile-sheet absolute inset-x-0 bottom-0 max-h-[86dvh] rounded-t-3xl border bg-card p-3 shadow-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-sheet-title"
        tabindex="-1"
      >
        <div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true"></div>
        <div class="flex items-center justify-between gap-2 border-b pb-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pi control center</p>
            <h2 id="mobile-sheet-title" class="text-lg font-semibold">{drawerTitle(activePanel)}</h2>
          </div>
          <Button bind:ref={mobileCloseButton} type="button" variant="outline" size="sm" onclick={closeMobilePanel} aria-label={`Close ${drawerTitle(activePanel)} panel`}>Close</Button>
        </div>

        <div class="phone-mobile-sheet-body max-h-[68dvh] overflow-y-auto pt-3">
          {#if activePanel === 'inspector'}
            <InspectorPanel stateStore={stateStore} {client} class="border-0 bg-transparent p-0 shadow-none" />
          {:else}
            <SheetBrowser stateStore={stateStore} {client} mode={activePanel} showHeader={false} compact />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
