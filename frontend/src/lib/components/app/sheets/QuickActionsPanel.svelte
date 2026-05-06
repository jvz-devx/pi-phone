<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import Archive from '@lucide/svelte/icons/archive';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import Bot from '@lucide/svelte/icons/bot';
  import Brain from '@lucide/svelte/icons/brain';
  import ListCommand from '@lucide/svelte/icons/list';
  import History from '@lucide/svelte/icons/history';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
  import { parentCommandControlsAvailable, runPhoneQuickAction, type PhoneQuickAction, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneStats } from '$lib/types/pi-phone';
  import { Shimmer } from '$lib/components/ai-elements/shimmer/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
  }

  type QuickActionConfig = {
    id: PhoneQuickAction;
    label: string;
    hint: string;
    description: string;
    icon: typeof RefreshCw;
    primary?: boolean;
  };

  const quickActions: QuickActionConfig[] = [
    { id: 'refresh', label: 'Refresh', hint: 'Snapshot', description: 'Pull the latest status, commands, models, and quota.', icon: RefreshCw, primary: true },
    { id: 'new-session', label: 'New session', hint: 'Clean chat', description: 'Start a fresh Pi session.', icon: MessageSquarePlus, primary: true },
    { id: 'compact', label: 'Compact', hint: 'Context', description: 'Ask Pi to compact the current session.', icon: Archive, primary: true },
    { id: 'stats', label: 'Stats', hint: 'Usage', description: 'Refresh session token and cost stats.', icon: BarChart3, primary: true },
    { id: 'models', label: 'Models', hint: 'Picker', description: 'Open the model picker.', icon: Bot },
    { id: 'thinking', label: 'Thinking', hint: 'Level', description: 'Open the thinking level picker.', icon: Brain },
    { id: 'commands', label: 'Commands', hint: 'Browser', description: 'Browse local and remote slash commands.', icon: ListCommand },
    { id: 'active-sessions', label: 'Active', hint: 'Workers', description: 'Switch parent and parallel active sessions.', icon: PanelsTopLeft },
    { id: 'sessions', label: 'Saved', hint: 'Sessions', description: 'Browse saved sessions for this project.', icon: History },
    { id: 'tree', label: 'Tree', hint: 'Branches', description: 'Browse the current branch tree.', icon: GitBranch },
  ];

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false }: Props = $props();

  let appState = $derived($stateStore);
  let snapshot = $derived(appState.snapshot.state);
  let modelLabel = $derived(snapshot?.model?.name || snapshot?.model?.id || 'Default');
  let thinkingLabel = $derived(snapshot?.thinkingLevel || '—');
  let parentControlsAvailable = $derived(parentCommandControlsAvailable(appState));

  function formatNumber(value: number | null | undefined) {
    return Number.isFinite(value) ? Number(value).toLocaleString() : '—';
  }

  function formatCost(value: number | null | undefined) {
    return Number.isFinite(value) ? `$${Number(value).toFixed(4)}` : '—';
  }

  function statChips(stats: PhoneStats | null) {
    if (!stats) return [];
    return [
      { label: 'Input', value: formatNumber(stats.tokens?.input) },
      { label: 'Output', value: formatNumber(stats.tokens?.output) },
      { label: 'Total', value: formatNumber(stats.tokens?.total) },
      { label: 'Tools', value: formatNumber(stats.toolCalls) },
      { label: 'Messages', value: formatNumber(stats.totalMessages) },
      { label: 'Cost', value: formatCost(stats.cost) },
    ];
  }

  function actionDisabled(action: PhoneQuickAction) {
    return action === 'new-session' && !parentControlsAvailable;
  }

  function actionTitle(action: QuickActionConfig) {
    if (actionDisabled(action.id)) return `${action.description} Run /phone-status in the terminal, then refresh to recapture command controls.`;
    return action.description;
  }

  function runAction(action: PhoneQuickAction) {
    if (actionDisabled(action)) return;
    runPhoneQuickAction(action, { store: stateStore, client });
  }
</script>

<div class={cn('grid gap-4', className)} aria-label="Quick actions">
  <div class="grid gap-3 sm:grid-cols-2">
    <Card.Root class="bg-secondary/25">
      <Card.Header class={compact ? 'p-3' : ''}>
        <Card.Title class="text-sm">Current setup</Card.Title>
        <Card.Description>Model and thinking state from the latest snapshot.</Card.Description>
      </Card.Header>
      <Card.Content class={cn('grid gap-2', compact && 'p-3 pt-0')}>
        <div class="flex items-center justify-between gap-2 rounded-2xl border bg-background/50 px-3 py-2">
          <span class="text-xs text-muted-foreground">Model</span>
          <Badge variant="outline" class="max-w-44 truncate bg-background/60">{modelLabel}</Badge>
        </div>
        <div class="flex items-center justify-between gap-2 rounded-2xl border bg-background/50 px-3 py-2">
          <span class="text-xs text-muted-foreground">Thinking</span>
          <Badge variant="outline" class="bg-background/60">{thinkingLabel}</Badge>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="bg-secondary/25">
      <Card.Header class={compact ? 'p-3' : ''}>
        <div class="flex items-start justify-between gap-2">
          <div>
            <Card.Title class="text-sm">Session stats</Card.Title>
            <Card.Description>Refresh to update token usage and cost.</Card.Description>
          </div>
          <Button variant="ghost" size="xs" onclick={() => runAction('stats')} aria-label="Refresh session stats">Refresh</Button>
        </div>
      </Card.Header>
      <Card.Content class={cn(compact && 'p-3 pt-0')}>
        {#if appState.stats}
          <div class="grid grid-cols-2 gap-2">
            {#each statChips(appState.stats) as chip}
              <div class="rounded-xl border bg-background/50 p-2">
                <div class="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{chip.label}</div>
                <div class="mt-1 font-mono text-xs">{chip.value}</div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="rounded-2xl border border-dashed bg-background/40 p-3 text-xs text-muted-foreground" aria-live="polite">
            <Shimmer content_length={32}>Session stats will appear here after Refresh Stats.</Shimmer>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <section>
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quick actions</h3>
      {#if appState.connection.connectionState}
        <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{appState.connection.connectionState}</Badge>
      {/if}
    </div>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {#each quickActions as action (action.id)}
        {@const Icon = action.icon}
        <Button
          variant={action.primary ? 'secondary' : 'outline'}
          class="h-auto justify-start gap-3 rounded-2xl px-3 py-3 text-left"
          onclick={() => runAction(action.id)}
          disabled={actionDisabled(action.id)}
          title={actionTitle(action)}
          aria-label={`${action.label}: ${action.description}`}
        >
          <Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0">
            <span class="block truncate">{action.label}</span>
            <span class="block truncate text-[0.65rem] font-normal text-muted-foreground">{action.hint}</span>
          </span>
        </Button>
      {/each}
    </div>
  </section>
</div>
