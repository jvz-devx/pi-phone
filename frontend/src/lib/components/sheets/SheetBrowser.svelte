<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { openPhoneSheet, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneSheetMode } from '$lib/types/pi-phone';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils';
  import CommandBrowser from '$lib/components/app/sheets/CommandBrowser.svelte';
  import ModelPicker from '$lib/components/app/sheets/ModelPicker.svelte';
  import QuickActionsPanel from '$lib/components/app/sheets/QuickActionsPanel.svelte';
  import ThinkingPicker from '$lib/components/app/sheets/ThinkingPicker.svelte';
  import ActiveSessionsView from './ActiveSessionsView.svelte';
  import SavedSessionsView from './SavedSessionsView.svelte';
  import SessionTreeView from './SessionTreeView.svelte';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
    compact?: boolean;
    mode?: PhoneSheetMode | null;
    showHeader?: boolean;
    onClose?: () => void;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', compact = false, mode = null, showHeader = true, onClose }: Props = $props();

  let appState = $derived($stateStore);
  let activeMode = $derived(mode || appState.sheets.mode);

  const titles: Record<PhoneSheetMode, string> = {
    actions: 'Actions',
    commands: 'Commands',
    models: 'Models',
    thinking: 'Thinking',
    sessions: 'Saved sessions',
    'active-sessions': 'Active sessions',
    tree: 'Session tree',
  };

  function close() {
    stateStore.setSheetOpen(false);
    onClose?.();
  }

  function openMode(nextMode: PhoneSheetMode) {
    openPhoneSheet(nextMode, { store: stateStore, client });
  }
</script>

<section class={cn('grid gap-3', className)} aria-label={titles[activeMode]}>
  {#if showHeader}
    <div class={cn('rounded-3xl border bg-card/82 shadow-xl backdrop-blur', compact ? 'p-3' : 'p-4')}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pi browser</p>
          <h2 class="text-base font-semibold">{titles[activeMode]}</h2>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close browser" onclick={close}>
          <X class="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant={activeMode === 'actions' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('actions')}>Actions</Button>
        <Button variant={activeMode === 'commands' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('commands')}>Commands</Button>
        <Button variant={activeMode === 'models' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('models')}>Models</Button>
        <Button variant={activeMode === 'thinking' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('thinking')}>Thinking</Button>
        <Button variant={activeMode === 'active-sessions' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('active-sessions')}>Active</Button>
        <Button variant={activeMode === 'sessions' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('sessions')}>Saved</Button>
        <Button variant={activeMode === 'tree' ? 'secondary' : 'outline'} size="xs" onclick={() => openMode('tree')}>Tree</Button>
      </div>
    </div>
  {/if}

  {#if activeMode === 'actions'}
    <QuickActionsPanel stateStore={stateStore} {client} {compact} />
  {:else if activeMode === 'commands'}
    <CommandBrowser stateStore={stateStore} {client} />
  {:else if activeMode === 'models'}
    <ModelPicker stateStore={stateStore} {client} />
  {:else if activeMode === 'thinking'}
    <ThinkingPicker stateStore={stateStore} {client} />
  {:else if activeMode === 'active-sessions'}
    <ActiveSessionsView stateStore={stateStore} {client} {compact} />
  {:else if activeMode === 'sessions'}
    <SavedSessionsView stateStore={stateStore} {client} {compact} />
  {:else if activeMode === 'tree'}
    <SessionTreeView stateStore={stateStore} {client} {compact} />
  {/if}
</section>
