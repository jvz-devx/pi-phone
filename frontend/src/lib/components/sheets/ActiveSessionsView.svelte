<script lang="ts">
  import { groupActiveSessions, activeSessionId, activeSessionLabel, activeSessionPreview, activeSessionStatusBits } from '$lib/adapters/sheet-adapter';
  import { openPhoneSheet, parentCommandControlsAvailable, selectActiveSession, spawnParallelSession, startNewParentSession, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSessionSummary } from '$lib/types/pi-phone';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
    onNavigate?: (mode: 'sessions') => void;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false, onNavigate }: Props = $props();

  let appState = $derived($stateStore);
  let groups = $derived(groupActiveSessions(appState));
  let selectedId = $derived(activeSessionId(appState));
  let controlsAvailable = $derived(parentCommandControlsAvailable(appState));

  function isCurrent(session: PhoneSessionSummary) {
    return session.id === selectedId;
  }

  function selectSession(session: PhoneSessionSummary) {
    if (isCurrent(session)) return;
    selectActiveSession(session.id, { store: stateStore, client });
  }

  function newParent() {
    startNewParentSession({ store: stateStore, client });
  }

  function newParallel() {
    spawnParallelSession({ store: stateStore, client });
  }

  function openSaved() {
    openPhoneSheet('sessions', { store: stateStore, client });
    onNavigate?.('sessions');
  }

  function badgeTone(bit: string) {
    if (bit === 'current') return 'bg-primary/90 text-primary-foreground border-primary/50';
    if (bit === 'live') return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';
    if (bit === 'needs input' || bit === 'command controls unavailable') return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    if (bit === 'compacting') return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
    return 'bg-background/60 text-muted-foreground';
  }
</script>

<section class={cn('grid gap-4', className)} aria-label="Active sessions">
  <div class={cn('rounded-3xl border bg-card/80 shadow-sm', compact ? 'p-3' : 'p-4')}>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active sessions</h2>
        <p class="mt-1 text-sm text-muted-foreground">Switch between the parent CLI mirror and parallel phone workers.</p>
      </div>
      <Button variant="outline" size="sm" onclick={openSaved}>Saved sessions</Button>
    </div>

    {#if !controlsAvailable}
      <div class="mt-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100" role="status">
        Parent command controls are unavailable until Pi provides a fresh command context. New Parent is disabled.
      </div>
    {/if}

    <div class="mt-4 grid grid-cols-2 gap-2">
      <Button variant="secondary" size="sm" onclick={newParent} disabled={!controlsAvailable}>New Parent</Button>
      <Button variant="secondary" size="sm" onclick={newParallel}>New Parallel</Button>
    </div>
  </div>

  {#each groups as group (group.kind)}
    <section class="rounded-3xl border bg-card/70 p-3 shadow-sm" aria-label={`${group.title} active sessions`}>
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.title}</h3>
          <p class="mt-1 text-xs text-muted-foreground">{group.description}</p>
        </div>
        <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{group.sessions.length}</Badge>
      </div>

      {#if group.sessions.length}
        <div class="grid gap-2">
          {#each group.sessions as session (session.id)}
            {@const statusBits = activeSessionStatusBits(session, appState)}
            <button
              type="button"
              class={cn(
                'w-full rounded-2xl border bg-background/45 p-3 text-left transition hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isCurrent(session) && 'border-primary/50 bg-primary/10',
                session.hasPendingUiRequest && 'border-amber-400/45 bg-amber-500/10',
              )}
              aria-current={isCurrent(session) ? 'page' : undefined}
              onclick={() => selectSession(session)}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold">{activeSessionLabel(session)}</div>
                  <div class="mt-1 break-all font-mono text-[0.68rem] text-muted-foreground">{session.sessionFile || session.sessionId || session.id}</div>
                </div>
                {#if session.childPid}
                  <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">pid {session.childPid}</Badge>
                {/if}
              </div>

              <div class="mt-2 flex flex-wrap gap-1.5">
                {#each statusBits as bit}
                  <Badge variant="outline" class={cn('text-[0.65rem]', badgeTone(bit))}>{bit}</Badge>
                {/each}
              </div>

              {#if activeSessionPreview(session)}
                <p class="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{activeSessionPreview(session)}</p>
              {/if}

              {#if session.lastError}
                <p class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{session.lastError}</p>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="rounded-2xl border border-dashed bg-secondary/25 p-3 text-xs leading-5 text-muted-foreground">
          {group.kind === 'parent' ? 'Parent session unavailable.' : 'No parallel sessions yet. Start one with New Parallel.'}
        </div>
      {/if}
    </section>
  {/each}

  <Separator />
  <div class="grid grid-cols-2 gap-2">
    <Button variant="outline" size="sm" onclick={openSaved}>Saved list</Button>
    <Button variant="outline" size="sm" onclick={() => openPhoneSheet('tree', { store: stateStore, client })}>Session tree</Button>
  </div>
</section>
