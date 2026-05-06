<script lang="ts">
  import { buildToolPreview } from '$lib/adapters/tool-adapter';
  import type { PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneAppState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSessionSummary, PhoneUiToolMessage } from '$lib/types/pi-phone';
  import { Loader } from '$lib/components/ai-elements/loader/index.js';
  import { Shimmer } from '$lib/components/ai-elements/shimmer/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import ComposerMeta from '$lib/components/chat/ComposerMeta.svelte';
  import QuickActionsPanel from './sheets/QuickActionsPanel.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false }: Props = $props();

  let appState = $derived($stateStore);
  let selectedSession = $derived(findSelectedSession(appState));
  let selectedTool = $derived(findSelectedTool(appState));
  let selectedToolPreview = $derived(selectedTool ? buildToolPreview(selectedTool) : null);
  let cwd = $derived(appState.status?.cwd || appState.auth.health?.cwd || '');
  let loadingState = $derived(['health-loading', 'connecting', 'reconnecting'].includes(appState.connection.connectionState));

  function findSelectedSession(state: PhoneAppState): PhoneSessionSummary | null {
    const id = state.sessions.activeSessionId || state.snapshot.workerId || state.status?.sessionWorkerId || '';
    return state.sessions.active.find((session) => session.id === id) || state.sessions.active[0] || null;
  }

  function findSelectedTool(state: PhoneAppState): PhoneUiToolMessage | null {
    const selectedId = state.tools.selectedToolId;
    const liveTools = [...state.tools.live.values()];
    if (selectedId) {
      const selectedLive = liveTools.find((tool) => tool.id === selectedId || tool.toolCallId === selectedId);
      if (selectedLive) return selectedLive;
      const selectedSettled = state.messages.items.find((message): message is PhoneUiToolMessage => message.kind === 'tool' && message.id === selectedId);
      if (selectedSettled) return selectedSettled;
    }
    if (liveTools.length) return liveTools[liveTools.length - 1] || null;
    return [...state.messages.items].reverse().find((message): message is PhoneUiToolMessage => message.kind === 'tool') || null;
  }

  function formatNumber(value: number | null | undefined) {
    return Number.isFinite(value) ? Number(value).toLocaleString() : '—';
  }

  function sessionStatus(session: PhoneSessionSummary | null) {
    if (!session) return [];
    return [
      session.kind,
      session.isStreaming ? 'live' : '',
      session.isCompacting ? 'compacting' : '',
      session.hasPendingUiRequest ? 'needs input' : '',
      session.commandContextAvailable === false ? 'commands unavailable' : '',
    ].filter(Boolean);
  }

</script>

<aside class={cn('rounded-3xl border bg-card/80 shadow-sm', compact ? 'p-3' : 'p-4', className)} aria-label="Inspector panel">
  <div class="space-y-5">
    <section>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Inspector</h2>
          <p class="mt-1 text-xs text-muted-foreground">Context, session state, tools, and actions</p>
        </div>
        {#if appState.connection.connectionState}
          <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{appState.connection.connectionState}</Badge>
        {/if}
      </div>
      <ComposerMeta stateStore={stateStore} class="mt-3" compact />
      {#if cwd}
        <div class="mt-3 rounded-2xl border bg-secondary/30 p-3">
          <div class="text-xs uppercase tracking-wide text-muted-foreground">Working directory</div>
          <div class="mt-1 break-words font-mono text-xs">{cwd}</div>
        </div>
      {/if}
    </section>

    <Separator />

    <QuickActionsPanel stateStore={stateStore} {client} compact />

    <Separator />

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selected session</h3>
      {#if selectedSession}
        <div class="mt-3 rounded-2xl border bg-secondary/30 p-3 text-sm">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-medium">{selectedSession.label || selectedSession.sessionName || selectedSession.id}</div>
              <div class="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedSession.sessionFile || selectedSession.sessionId || selectedSession.id}</div>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              {#each sessionStatus(selectedSession) as bit}
                <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{bit}</Badge>
              {/each}
            </div>
          </div>
          {#if selectedSession.lastUserPreview || selectedSession.firstUserPreview}
            <p class="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{selectedSession.lastUserPreview || selectedSession.firstUserPreview}</p>
          {/if}
          <dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-xl border bg-background/40 p-2">
              <dt class="text-muted-foreground">Messages</dt>
              <dd class="mt-1 font-mono">{formatNumber(selectedSession.messageCount)}</dd>
            </div>
            <div class="rounded-xl border bg-background/40 p-2">
              <dt class="text-muted-foreground">Model</dt>
              <dd class="mt-1 truncate">{selectedSession.model?.name || selectedSession.model?.id || '—'}</dd>
            </div>
          </dl>
        </div>
      {:else}
        <div class="mt-3 rounded-2xl border border-dashed bg-secondary/20 p-3 text-xs text-muted-foreground" aria-live="polite">
          {#if loadingState}
            <div class="flex items-center gap-2">
              <Loader size={16} class="text-primary" aria-hidden="true" />
              <Shimmer content_length={22}>Loading session catalog…</Shimmer>
            </div>
          {:else}
            No active session catalog yet.
          {/if}
        </div>
      {/if}
    </section>

    <Separator />

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selected tool</h3>
      {#if selectedTool && selectedToolPreview}
        <div class="mt-3 rounded-2xl border bg-secondary/30 p-3 text-sm">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-medium">{selectedToolPreview.toolName}</div>
              <div class="mt-1 truncate text-xs text-muted-foreground">{selectedToolPreview.subject || selectedTool.command || selectedTool.title || 'Tool call'}</div>
            </div>
            <Badge variant="outline" class={cn('bg-background/60 text-[0.65rem]', selectedTool.status === 'error' ? 'text-destructive' : selectedTool.status === 'running' ? 'text-emerald-200' : 'text-muted-foreground')}>{selectedToolPreview.statusLabel}</Badge>
          </div>
          {#if selectedToolPreview.badges.length}
            <div class="mt-3 flex flex-wrap gap-1.5">
              {#each selectedToolPreview.badges as badge}
                <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{badge.label}</Badge>
              {/each}
            </div>
          {/if}
          {#if selectedTool.text}
            <pre class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border bg-background/60 p-2 text-xs text-muted-foreground">{selectedTool.text}</pre>
          {:else if selectedTool.args}
            <pre class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border bg-background/60 p-2 text-xs text-muted-foreground">{JSON.stringify(selectedTool.args, null, 2)}</pre>
          {/if}
        </div>
      {:else}
        <div class="mt-3 rounded-2xl border border-dashed bg-secondary/20 p-3 text-xs text-muted-foreground" aria-live="polite">
          {#if loadingState}
            <Shimmer content_length={28}>Tool details will appear after activity starts.</Shimmer>
          {:else}
            Select a tool card to pin details here.
          {/if}
        </div>
      {/if}
    </section>
  </div>
</aside>
