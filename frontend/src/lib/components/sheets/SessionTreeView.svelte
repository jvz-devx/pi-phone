<script lang="ts">
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import { forkSessionEntry, openBranchPath, parentCommandControlsAvailable, refreshSessionTree, treeBelongsToCurrentSession, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { mapTreeNodes, treeFileLabel } from '$lib/adapters/sheet-adapter';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { TreeListNode } from '$lib/adapters/sheet-adapter';
  import { Loader } from '$lib/components/ai-elements/loader/index.js';
  import { Shimmer } from '$lib/components/ai-elements/shimmer/index.js';
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
  let tree = $derived(appState.tree);
  let nodes = $derived(mapTreeNodes(tree));
  let loading = $derived(!tree && ['health-loading', 'connecting', 'reconnecting'].includes(appState.connection.connectionState));
  let treeActionsAvailable = $derived(parentCommandControlsAvailable(appState) && treeBelongsToCurrentSession(appState));
  let treeActionUnavailableTitle = $derived(
    !parentCommandControlsAvailable(appState)
      ? 'Run /phone-status in the terminal, then refresh to recapture command controls.'
      : !treeBelongsToCurrentSession(appState)
        ? 'Refresh the session tree for the current session before using branch actions.'
        : undefined,
  );

  function refresh() {
    refreshSessionTree({ client });
  }

  function openPath(node: TreeListNode) {
    if (!treeActionsAvailable) return;
    openBranchPath(node.id, { store: stateStore, client });
  }

  function forkHere(node: TreeListNode) {
    if (!treeActionsAvailable) return;
    forkSessionEntry(node.id, { store: stateStore, client });
  }

  function canFork(node: TreeListNode) {
    return node.summary?.role === 'user';
  }

  function markerTone(node: TreeListNode) {
    if (node.isCurrent) return 'border-primary bg-primary text-primary-foreground';
    if (node.isOnActivePath) return 'border-primary/55 bg-primary/20 text-primary';
    if (node.isBranchPoint) return 'border-amber-400/45 bg-amber-500/15 text-amber-100';
    return 'border-border bg-background text-muted-foreground';
  }
</script>

<section class={cn('grid gap-4', className)} aria-label="Session tree">
  <div class={cn('rounded-3xl border bg-card/80 shadow-sm', compact ? 'p-3' : 'p-4')}>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Session tree</h2>
        <p class="mt-1 text-sm text-muted-foreground">Open any branch path as a session. User turns can also be forked when Pi exposes fork controls.</p>
      </div>
      <Button variant="outline" size="sm" onclick={refresh} class="gap-2" aria-label="Refresh session tree" title="Refresh session tree">
        <RotateCw class="size-3.5" aria-hidden="true" />
        Refresh
      </Button>
    </div>

    {#if tree}
      <div class="mt-3 rounded-2xl border bg-secondary/30 p-3">
        <div class="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Session file</div>
        <div class="mt-1 truncate text-sm font-medium">{treeFileLabel(tree)}</div>
        <div class="mt-1 break-all font-mono text-[0.68rem] text-muted-foreground">{tree.sessionFile}</div>
      </div>
    {/if}
  </div>

  {#if tree && nodes.length}
    <div class="rounded-3xl border bg-card/70 p-3 shadow-sm">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Branches</h3>
        <div class="flex gap-1.5">
          <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{nodes.length} nodes</Badge>
          {#if tree.currentLeafId}
            <Badge variant="outline" class="bg-primary/10 text-[0.65rem] text-primary">active path</Badge>
          {/if}
        </div>
      </div>

      <ol class="grid gap-2" aria-label="Session tree nodes">
        {#each nodes as node (node.id)}
          <li
            class={cn(
              'relative rounded-2xl border bg-background/45 p-3',
              node.isCurrent && 'border-primary/55 bg-primary/10',
              node.isOnActivePath && !node.isCurrent && 'border-primary/30 bg-primary/5',
            )}
            style:margin-left={`${Math.min(node.depth * 0.75, 4.5)}rem`}
          >
            <div class="flex items-start gap-3">
              <div class={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', markerTone(node))} aria-hidden="true">
                {node.depth + 1}
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-semibold">{node.primaryLabel}</span>
                  {#if node.roleLabel}
                    <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{node.roleLabel}</Badge>
                  {/if}
                  {#if node.modelLabel}
                    <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{node.modelLabel}</Badge>
                  {/if}
                  {#if node.label}
                    <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">#{node.label}</Badge>
                  {/if}
                  {#if node.isCurrent}
                    <Badge class="bg-primary/90 text-[0.65rem]">current</Badge>
                  {:else if node.isOnActivePath}
                    <Badge variant="outline" class="bg-primary/10 text-[0.65rem] text-primary">path</Badge>
                  {/if}
                  {#if node.isBranchPoint}
                    <Badge variant="outline" class="border-amber-400/40 bg-amber-500/10 text-[0.65rem] text-amber-100">{node.childCount} branches</Badge>
                  {/if}
                </div>

                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
                  <span>{node.timestampLabel}</span>
                  <span class="font-mono">{node.id}</span>
                </div>
                <p class="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{node.preview}</p>

                <div class="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="xs" onclick={() => openPath(node)} class="gap-1.5" disabled={!treeActionsAvailable} title={treeActionUnavailableTitle}>
                    <GitBranch class="size-3" aria-hidden="true" />
                    Open path
                  </Button>
                  {#if canFork(node)}
                    <Button variant="outline" size="xs" onclick={() => forkHere(node)} class="gap-1.5" disabled={!treeActionsAvailable} title={treeActionUnavailableTitle}>
                      <GitFork class="size-3" aria-hidden="true" />
                      Fork here
                    </Button>
                  {/if}
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ol>
    </div>
  {:else if tree}
    <div class="rounded-3xl border border-dashed bg-secondary/20 p-4 text-sm text-muted-foreground">This session tree has no nodes yet.</div>
  {:else}
    <div class="rounded-3xl border border-dashed bg-secondary/20 p-4 text-sm leading-6 text-muted-foreground" aria-live="polite">
      {#if loading}
        <div class="flex items-center gap-3">
          <Loader size={18} class="text-primary" aria-hidden="true" />
          <Shimmer content_length={20}>Loading session tree…</Shimmer>
        </div>
      {:else}
        No session tree is loaded yet. Use Refresh after a session file is available.
      {/if}
    </div>
  {/if}
</section>
