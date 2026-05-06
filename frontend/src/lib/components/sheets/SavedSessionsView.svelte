<script lang="ts">
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import { forkSessionEntry, refreshSavedSessions, switchSavedSession, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { groupSavedSessions, savedSessionForkEntryId, savedSessionPreview, savedSessionSubtitle, savedSessionTitle } from '$lib/adapters/sheet-adapter';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSavedSession } from '$lib/types/pi-phone';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false }: Props = $props();

  let appState = $derived($stateStore);
  let groups = $derived(groupSavedSessions(appState.sessions.saved));
  let activeFile = $derived(appState.snapshot.state?.sessionFile || '');

  function refresh() {
    refreshSavedSessions({ client });
  }

  function switchSession(session: PhoneSavedSession) {
    switchSavedSession(session.path, { store: stateStore, client });
  }

  function forkSaved(session: PhoneSavedSession) {
    const entryId = savedSessionForkEntryId(session);
    if (!entryId) return;
    forkSessionEntry(entryId, { store: stateStore, client });
  }

  function isCurrent(session: PhoneSavedSession) {
    return Boolean(activeFile && session.path === activeFile);
  }
</script>

<section class={cn('grid gap-4', className)} aria-label="Saved sessions">
  <div class={cn('rounded-3xl border bg-card/80 shadow-sm', compact ? 'p-3' : 'p-4')}>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Saved sessions</h2>
        <p class="mt-1 text-sm text-muted-foreground">Resume sessions for this project. Parallel children are grouped under their parent when Pi exposes that relationship.</p>
      </div>
      <Button variant="outline" size="sm" onclick={refresh} class="gap-2">
        <RotateCw class="size-3.5" aria-hidden="true" />
        Refresh
      </Button>
    </div>
  </div>

  {#if appState.sessions.saved.length}
    {#each groups as group (group.key)}
      <section class="rounded-3xl border bg-card/70 p-3 shadow-sm" aria-label={group.title}>
        <div class="mb-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.title}</h3>
            <p class="mt-1 truncate text-xs text-muted-foreground" title={group.description}>{group.description}</p>
          </div>
          <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{group.sessions.length}</Badge>
        </div>

        <div class="grid gap-2">
          {#each group.sessions as session (session.path)}
            {@const forkEntryId = savedSessionForkEntryId(session)}
            <article class={cn('rounded-2xl border bg-background/45 p-3', isCurrent(session) && 'border-primary/50 bg-primary/10')}>
              <div class="flex items-start justify-between gap-3">
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => switchSession(session)}
                  aria-current={isCurrent(session) ? 'page' : undefined}
                >
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span class="truncate text-sm font-semibold">{savedSessionTitle(session)}</span>
                    {#if isCurrent(session)}
                      <Badge class="bg-primary/90 text-[0.65rem]">current</Badge>
                    {/if}
                    {#if session.parentSessionPath}
                      <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">parallel</Badge>
                    {:else}
                      <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">parent</Badge>
                    {/if}
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">{savedSessionSubtitle(session)}</div>
                  <div class="mt-1 break-all font-mono text-[0.68rem] text-muted-foreground">{session.path}</div>
                  {#if savedSessionPreview(session)}
                    <p class="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{savedSessionPreview(session)}</p>
                  {/if}
                </button>

                <div class="flex shrink-0 flex-col gap-1.5">
                  <Button variant="secondary" size="xs" onclick={() => switchSession(session)}>Switch</Button>
                  {#if forkEntryId}
                    <Button variant="outline" size="xs" onclick={() => forkSaved(session)} class="gap-1.5" title="Fork from the saved session entry exposed by the server">
                      <GitFork class="size-3" aria-hidden="true" />
                      Fork
                    </Button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/each}
  {:else}
    <div class="rounded-3xl border border-dashed bg-secondary/20 p-4 text-sm leading-6 text-muted-foreground">
      No sessions found yet for this working directory. Use Refresh after Pi has created or resumed sessions.
    </div>
  {/if}
</section>
