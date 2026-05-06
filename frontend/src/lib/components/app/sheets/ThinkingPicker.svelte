<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Brain from '@lucide/svelte/icons/brain';
  import { THINKING_LEVELS, type PhoneCommandActionClient } from '$lib/actions/phone-commands';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneThinkingLevel } from '$lib/types/pi-phone';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneCommandActionClient;
    class?: string;
  }

  const descriptions: Record<string, string> = {
    off: 'Disable explicit reasoning budget where supported.',
    minimal: 'Smallest reasoning budget for fast routine edits.',
    low: 'Light reasoning for simple coding and review tasks.',
    medium: 'Balanced default for multi-step implementation work.',
    high: 'More reasoning for hard debugging and design work.',
    xhigh: 'Maximum reasoning budget for complex tasks.',
  };

  let { stateStore = piPhoneState, client = phoneClient, class: className = '' }: Props = $props();

  let appState = $derived($stateStore);
  let currentLevel = $derived(appState.snapshot.state?.thinkingLevel || '');

  function selectLevel(level: PhoneThinkingLevel) {
    const sent = client.sendRpc({ type: 'set_thinking_level', level });
    if (sent) stateStore.setSheetOpen(false);
  }
</script>

<section class={cn('grid gap-4', className)} aria-label="Thinking picker">
  <Card.Root class="bg-secondary/25">
    <Card.Header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <Card.Title>Thinking level</Card.Title>
          <Card.Description>Choose the reasoning budget Pi should request for future model calls.</Card.Description>
        </div>
        <Badge variant="outline" class="bg-background/60">Current: {currentLevel || 'default'}</Badge>
      </div>
    </Card.Header>
  </Card.Root>

  <div class="grid gap-2">
    {#each THINKING_LEVELS as level (level)}
      {@const selected = currentLevel === level}
      <Button
        variant={selected ? 'secondary' : 'outline'}
        class={cn('h-auto justify-start rounded-2xl px-3 py-3 text-left', selected && 'border-primary/40 bg-primary/10')}
        aria-current={selected ? 'true' : undefined}
        onclick={() => selectLevel(level)}
      >
        <Brain class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="font-medium capitalize">{level}</span>
            {#if selected}
              <Badge variant="outline" class="bg-primary/10 text-[0.65rem] text-primary"><Check class="mr-1 size-3" aria-hidden="true" /> current</Badge>
            {/if}
          </span>
          <span class="mt-1 block whitespace-normal text-xs font-normal leading-5 text-muted-foreground">{descriptions[level] || 'Custom thinking level.'}</span>
        </span>
      </Button>
    {/each}
  </div>

  {#if currentLevel && !(THINKING_LEVELS as readonly string[]).includes(currentLevel)}
    <div class="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
      Pi reports a custom thinking level ({currentLevel}). Pick one of the supported levels above to replace it.
    </div>
  {/if}
</section>
