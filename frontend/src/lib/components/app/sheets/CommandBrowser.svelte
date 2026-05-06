<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import {
    commandCategoryLabel,
    groupedCommands,
    handleInsertOnlyLocalCommand,
    sendRemoteSlashCommand,
    tryHandleLocalCommand,
    type PhoneCommandActionClient,
  } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneCommand } from '$lib/types/pi-phone';
  import { Loader } from '$lib/components/ai-elements/loader/index.js';
  import { Shimmer } from '$lib/components/ai-elements/shimmer/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    class?: string;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '' }: Props = $props();

  let appState = $derived($stateStore);
  let filter = $state('');
  let groups = $derived(groupedCommands(appState.commands.available));
  let categories = $derived([...groups.keys()]);
  let activeCategory = $derived(categories.includes(appState.sheets.commandCategory) ? appState.sheets.commandCategory : categories[0] || '');
  let activeCommands = $derived(filterCommands(groups.get(activeCategory) || [], filter));
  let filterRef = $state<HTMLInputElement | null>(null);
  let loading = $derived(!appState.commands.available.length && ['health-loading', 'connecting', 'reconnecting'].includes(appState.connection.connectionState));

  function filterCommands(commands: PhoneCommand[], query: string) {
    const clean = query.trim().toLowerCase();
    if (!clean) return commands;
    return commands.filter((command) => {
      const haystack = [command.name, command.description, command.path, command.location, command.sourceInfo?.path, command.source]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(clean);
    });
  }

  function setCategory(category: string) {
    stateStore.setCommandSheetCategory(category);
  }

  function closeSheet() {
    stateStore.setSheetOpen(false);
  }

  function commandLabel(command: PhoneCommand) {
    return `/${command.name}`;
  }

  function commandMeta(command: PhoneCommand) {
    return [command.source || 'command', command.path || command.location || command.sourceInfo?.path || ''].filter(Boolean).join(' · ');
  }

  function insertCommand(command: PhoneCommand) {
    if (!command.name) return;

    if (command.source === 'local' && command.insertOnly) {
      const result = handleInsertOnlyLocalCommand(command.name, { text: stateStore.snapshot().composer.text });
      if (result) stateStore.setComposerText(result.text);
    } else {
      stateStore.setComposerText(`/${command.name} `);
    }

    stateStore.clearAutocomplete();
    closeSheet();
  }

  function runLocalCommand(command: PhoneCommand) {
    if (!command.name) return;
    if (command.insertOnly) {
      insertCommand(command);
      return;
    }

    const result = tryHandleLocalCommand(`/${command.name}`, {
      store: stateStore,
      client,
      hasAttachments: stateStore.snapshot().attachments.items.length > 0,
    });

    if (result === 'handled') {
      stateStore.setComposerText('');
      stateStore.clearAutocomplete();
    }
  }

  function runRemoteCommand(command: PhoneCommand) {
    if (!command.name) return;
    const result = sendRemoteSlashCommand(
      { name: command.name, text: `/${command.name}`, source: command.source || 'extension' },
      { store: stateStore, client },
    );
    if (result === 'handled') closeSheet();
  }

  function primaryAction(command: PhoneCommand) {
    if (command.source === 'local') runLocalCommand(command);
    else insertCommand(command);
  }

  onMount(() => {
    void tick().then(() => filterRef?.focus());
  });
</script>

<section class={cn('grid gap-4', className)} aria-label="Command browser">
  <Card.Root class="bg-secondary/25">
    <Card.Header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <Card.Title>Commands, skills, and prompts</Card.Title>
          <Card.Description>Run local phone commands immediately, or insert remote slash commands into the composer.</Card.Description>
        </div>
        <Badge variant="outline" class="bg-background/60">{categories.length} groups</Badge>
      </div>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <Input bind:ref={filterRef} bind:value={filter} placeholder="Filter commands…" aria-label="Filter commands" />
      <div class="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Command categories">
        {#each categories as category (category)}
          <Button
            variant={category === activeCategory ? 'secondary' : 'outline'}
            size="sm"
            role="tab"
            aria-selected={category === activeCategory}
            aria-pressed={category === activeCategory}
            onclick={() => setCategory(category)}
          >
            {commandCategoryLabel(category)}
            <span class="ml-1 text-[0.65rem] text-muted-foreground">{groups.get(category)?.length || 0}</span>
          </Button>
        {/each}
      </div>
    </Card.Content>
  </Card.Root>

  {#if !categories.length}
    <div class="rounded-2xl border border-dashed bg-secondary/20 p-4 text-sm text-muted-foreground" aria-live="polite">
      {#if loading}
        <div class="flex items-center gap-3">
          <Loader size={18} class="text-primary" aria-hidden="true" />
          <Shimmer content_length={28}>Loading command catalog…</Shimmer>
        </div>
      {:else}
        No commands are available yet. Refresh Pi state to load extension commands, skills, and prompts.
      {/if}
    </div>
  {:else}
    <div class="grid gap-2">
      {#if !activeCommands.length}
        <div class="rounded-2xl border border-dashed bg-secondary/20 p-4 text-sm text-muted-foreground">
          No {commandCategoryLabel(activeCategory).toLowerCase()} commands match this filter.
        </div>
      {/if}

      {#each activeCommands as command (`${command.source || 'command'}:${command.name}`)}
        <Card.Root class="bg-card/80">
          <Card.Content class="flex items-start gap-3 p-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-mono text-sm font-semibold">{commandLabel(command)}</h3>
                <Badge variant="outline" class="bg-background/60 text-[0.65rem]">{commandCategoryLabel(command.source || 'command')}</Badge>
                {#if command.insertOnly}
                  <Badge variant="outline" class="bg-primary/10 text-[0.65rem] text-primary">insert only</Badge>
                {/if}
              </div>
              <p class="mt-1 text-sm leading-5 text-muted-foreground">{command.description || 'No description available.'}</p>
              {#if commandMeta(command)}
                <p class="mt-2 break-all font-mono text-[0.7rem] text-muted-foreground">{commandMeta(command)}</p>
              {/if}
            </div>
            <div class="flex shrink-0 flex-col gap-2">
              <Button size="sm" variant={command.source === 'local' && !command.insertOnly ? 'secondary' : 'default'} onclick={() => primaryAction(command)}>
                {#if command.source === 'local' && !command.insertOnly}
                  <Play class="size-3.5" aria-hidden="true" />
                  Run
                {:else}
                  <Plus class="size-3.5" aria-hidden="true" />
                  Insert
                {/if}
              </Button>
              {#if command.source === 'local' && !command.insertOnly}
                <Button size="xs" variant="outline" onclick={() => insertCommand(command)}>Insert</Button>
              {:else if command.source !== 'local'}
                <Button size="xs" variant="outline" onclick={() => runRemoteCommand(command)}>Run now</Button>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</section>
