<script lang="ts">
  import { activeSessionStatusBits, sortActiveSessions } from '$lib/adapters/sheet-adapter';
  import { runPhoneQuickAction, selectActiveSession, spawnParallelSession, startNewParentSession, parentCommandControlsAvailable, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSessionKind, PhoneSessionSummary } from '$lib/types/pi-phone';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import SessionRailSection from './SessionRailSection.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false }: Props = $props();

  let appState = $derived($stateStore);
  let sortedSessions = $derived(sortActiveSessions(appState));
  let parentSessions = $derived(sortedSessions.filter((session) => session.kind === 'parent'));
  let parallelSessions = $derived(sortedSessions.filter((session) => session.kind === 'parallel'));
  let controlsAvailable = $derived(parentCommandControlsAvailable(appState));
  let selectedId = $derived(appState.sessions.activeSessionId || appState.snapshot.workerId || appState.status?.sessionWorkerId || null);

  function sessionLabel(session: PhoneSessionSummary) {
    return session.label || session.sessionName || session.sessionId || session.id || 'Session';
  }

  function sessionPreview(session: PhoneSessionSummary) {
    return session.lastUserPreview || session.firstUserPreview || session.secondaryLabel || '';
  }

  function isCurrent(session: PhoneSessionSummary) {
    return session.id === selectedId;
  }

  function sessionMeta(session: PhoneSessionSummary) {
    return [...activeSessionStatusBits(session, appState), session.cwd || ''].filter(Boolean).join(' · ');
  }

  function sectionTitle(kind: PhoneSessionKind) {
    return kind === 'parent' ? 'Parent' : 'Parallel';
  }

  function handleSelect(session: PhoneSessionSummary) {
    if (isCurrent(session)) return;
    selectActiveSession(session.id, { store: stateStore, client });
  }

  function handleNewParent() {
    startNewParentSession({ store: stateStore, client });
  }

  function handleNewParallel() {
    spawnParallelSession({ store: stateStore, client });
  }

  function openSavedSessions() {
    runPhoneQuickAction('sessions', { store: stateStore, client });
  }
</script>

<aside class={cn('flex h-full min-h-0 flex-col rounded-3xl border bg-card/80 shadow-xl', compact ? 'p-3' : 'p-4', className)} aria-label="Session rail">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sessions</h2>
      <p class="mt-1 truncate text-xs text-muted-foreground">Parent CLI plus parallel phone workers</p>
    </div>
    <Button variant="outline" size="sm" onclick={openSavedSessions} aria-label="Open saved sessions">Saved</Button>
  </div>

  {#if !controlsAvailable}
    <div class="mt-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100" role="status">
      Parent command controls are unavailable until Pi provides a fresh command context. New Parent is disabled.
    </div>
  {/if}

  <div class="mt-4 grid grid-cols-2 gap-2">
    <Button variant="secondary" size="sm" onclick={handleNewParent} disabled={!controlsAvailable}>New Parent</Button>
    <Button variant="secondary" size="sm" onclick={handleNewParallel}>New Parallel</Button>
  </div>

  <Separator class="my-4" />

  <div class="min-h-0 flex-1 overflow-y-auto pr-1">
    <SessionRailSection
      title={sectionTitle('parent')}
      sessions={parentSessions}
      empty="Parent session unavailable."
      onSelect={handleSelect}
      {sessionLabel}
      {sessionPreview}
      {sessionMeta}
      {isCurrent}
    />
    <SessionRailSection
      title={sectionTitle('parallel')}
      sessions={parallelSessions}
      empty="No parallel sessions yet. Start one with New Parallel."
      onSelect={handleSelect}
      {sessionLabel}
      {sessionPreview}
      {sessionMeta}
      {isCurrent}
      class="mt-5"
    />
  </div>
</aside>
