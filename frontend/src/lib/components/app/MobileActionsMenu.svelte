<script lang="ts">
  import { runPhoneQuickAction, type PhoneQuickAction, type PhoneSessionActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import InspectorPanel from './InspectorPanel.svelte';
  import SessionRail from './SessionRail.svelte';
  import QuickActionsPanel from './sheets/QuickActionsPanel.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneSessionActionClient;
    class?: string;
  }

  type MenuAction = { id: PhoneQuickAction; label: string; description: string };

  const primaryActions: MenuAction[] = [
    { id: 'refresh', label: 'Refresh snapshot', description: 'Pull latest state' },
    { id: 'new-session', label: 'New session', description: 'Start clean chat' },
    { id: 'compact', label: 'Compact session', description: 'Reduce context' },
    { id: 'stats', label: 'Refresh stats', description: 'Usage details' },
  ];

  const browserActions: MenuAction[] = [
    { id: 'models', label: 'Models', description: 'Open picker' },
    { id: 'thinking', label: 'Thinking', description: 'Change level' },
    { id: 'commands', label: 'Commands', description: 'Browse slash commands' },
    { id: 'active-sessions', label: 'Active sessions', description: 'Parent and parallel workers' },
    { id: 'sessions', label: 'Saved sessions', description: 'Switch or fork' },
    { id: 'tree', label: 'Session tree', description: 'Branch browser' },
  ];

  let { stateStore = piPhoneState, client = phoneClient, class: className = '' }: Props = $props();

  let actionsOpen = $state(false);
  let sessionsOpen = $state(false);
  let inspectorOpen = $state(false);

  function runAction(action: PhoneQuickAction) {
    runPhoneQuickAction(action, { store: stateStore, client });
    actionsOpen = false;
  }
</script>

<div class={cn('flex items-center gap-2', className)} aria-label="Mobile actions">
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      <Button variant="outline" size="sm" aria-label="Open compact actions menu">Actions</Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-64">
      <DropdownMenu.Label>Quick actions</DropdownMenu.Label>
      {#each primaryActions as action (action.id)}
        <DropdownMenu.Item onSelect={() => runAction(action.id)}>
          <div class="flex min-w-0 flex-col">
            <span>{action.label}</span>
            <span class="text-xs text-muted-foreground">{action.description}</span>
          </div>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator />
      {#each browserActions as action (action.id)}
        <DropdownMenu.Item onSelect={() => runAction(action.id)}>
          <div class="flex min-w-0 flex-col">
            <span>{action.label}</span>
            <span class="text-xs text-muted-foreground">{action.description}</span>
          </div>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={() => (actionsOpen = true)}>Open actions sheet</DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => (sessionsOpen = true)}>Open session rail</DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => (inspectorOpen = true)}>Open inspector</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <Button variant="secondary" size="sm" class="sm:hidden" onclick={() => (sessionsOpen = true)}>Sessions</Button>
  <Button variant="secondary" size="sm" class="sm:hidden" onclick={() => (inspectorOpen = true)}>Info</Button>
</div>

<Dialog.Root bind:open={actionsOpen}>
  <Dialog.Content class="bottom-0 top-auto max-h-[min(85dvh,42rem)] max-w-none translate-y-0 overflow-y-auto rounded-b-none p-4 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-xl" aria-label="Quick actions sheet">
    <Dialog.Header>
      <Dialog.Title>Quick actions</Dialog.Title>
      <Dialog.Description>All side-panel actions remain available on mobile.</Dialog.Description>
    </Dialog.Header>
    <QuickActionsPanel stateStore={stateStore} {client} compact />
    <Separator />
    <div class="grid grid-cols-2 gap-2">
      <Button variant="outline" onclick={() => { actionsOpen = false; sessionsOpen = true; }}>Session rail</Button>
      <Button variant="outline" onclick={() => { actionsOpen = false; inspectorOpen = true; }}>Inspector</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={sessionsOpen}>
  <Dialog.Content class="bottom-0 top-auto max-h-[min(90dvh,46rem)] max-w-none translate-y-0 overflow-hidden rounded-b-none p-3 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-xl" aria-label="Sessions sheet">
    <Dialog.Header class="px-1">
      <Dialog.Title>Sessions</Dialog.Title>
      <Dialog.Description>Switch parent or parallel sessions without a side rail.</Dialog.Description>
    </Dialog.Header>
    <SessionRail stateStore={stateStore} {client} class="max-h-[70dvh] border-0 bg-transparent p-0 shadow-none" compact />
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={inspectorOpen}>
  <Dialog.Content class="bottom-0 top-auto max-h-[min(90dvh,46rem)] max-w-none translate-y-0 overflow-y-auto rounded-b-none p-3 sm:bottom-auto sm:top-1/2 sm:max-w-xl sm:-translate-y-1/2 sm:rounded-xl" aria-label="Inspector sheet">
    <Dialog.Header class="px-1">
      <Dialog.Title>Inspector</Dialog.Title>
      <Dialog.Description>Context, quota, stats, selected session, and tool details.</Dialog.Description>
    </Dialog.Header>
    <InspectorPanel stateStore={stateStore} {client} class="border-0 bg-transparent p-0 shadow-none" compact />
  </Dialog.Content>
</Dialog.Root>
