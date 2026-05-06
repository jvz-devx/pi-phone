<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Search from '@lucide/svelte/icons/search';
  import { phoneClient, type PhoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneModel } from '$lib/types/pi-phone';
  import * as ModelSelector from '$lib/components/ai-elements/model-selector/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: Pick<PhoneClient, 'sendRpc'>;
    class?: string;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '' }: Props = $props();

  let appState = $derived($stateStore);
  let selectorOpen = $state(false);
  let selectorValue = $state('');
  let currentModel = $derived(appState.snapshot.state?.model || appState.connection.client?.currentModel || null);
  let modelGroups = $derived(groupModels(appState.models.available));

  function groupModels(models: PhoneModel[]) {
    const groups = new Map<string, PhoneModel[]>();
    for (const model of models) {
      const provider = model.provider || 'unknown';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)?.push(model);
    }
    for (const group of groups.values()) group.sort((left, right) => modelName(left).localeCompare(modelName(right)));
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }

  function modelName(model: PhoneModel) {
    return model.name || model.id || 'Model';
  }

  function modelKey(model: PhoneModel) {
    return `${model.provider}/${model.id}`;
  }

  function isCurrent(model: PhoneModel) {
    return currentModel?.provider === model.provider && (currentModel?.id === model.id || currentModel?.modelId === model.id);
  }

  function contextLabel(model: PhoneModel) {
    return Number.isFinite(model.contextWindow) ? `${Number(model.contextWindow).toLocaleString()} tokens` : '';
  }

  function selectModel(model: PhoneModel) {
    if (!model.provider || !model.id) return;
    const sent = client.sendRpc({ type: 'set_model', provider: model.provider, modelId: model.id });
    if (!sent) return;
    stateStore.update((state) => {
      state.quota.refreshNeeded = true;
      state.quota.forceRefresh = true;
      state.connection.forceQuotaRefreshRequested = true;
      return state;
    });
    selectorOpen = false;
    stateStore.setSheetOpen(false);
  }
</script>

<section class={cn('grid gap-4', className)} aria-label="Model picker">
  <Card.Root class="bg-secondary/25">
    <Card.Header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <Card.Title>Models</Card.Title>
          <Card.Description>Select a provider/model id. The current model is highlighted.</Card.Description>
        </div>
        <Badge variant="outline" class="bg-background/60">{appState.models.available.length} available</Badge>
      </div>
    </Card.Header>
    <Card.Content class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1 rounded-2xl border bg-background/50 px-3 py-2 text-sm">
        <div class="text-xs uppercase tracking-wide text-muted-foreground">Current</div>
        <div class="mt-1 truncate font-medium">{currentModel?.name || currentModel?.id || 'Default'}</div>
        {#if currentModel?.provider || currentModel?.id || currentModel?.modelId}
          <div class="mt-1 truncate font-mono text-xs text-muted-foreground">{currentModel?.provider || 'unknown'}/{currentModel?.id || currentModel?.modelId || ''}</div>
        {/if}
      </div>

      <ModelSelector.ModelSelector bind:open={selectorOpen}>
        <ModelSelector.Trigger>
          <Button variant="secondary" class="gap-2">
            <Search class="size-4" aria-hidden="true" />
            Search models
          </Button>
        </ModelSelector.Trigger>
        <ModelSelector.Content class="max-h-[min(80dvh,40rem)] max-w-2xl overflow-hidden">
          <ModelSelector.Input bind:value={selectorValue} placeholder="Search models…" />
          <ModelSelector.List class="max-h-[60dvh] overflow-y-auto">
            <ModelSelector.Empty>No models found.</ModelSelector.Empty>
            {#each modelGroups as [provider, models] (provider)}
              <ModelSelector.Group heading={provider}>
                {#each models as model (modelKey(model))}
                  <ModelSelector.Item value={`${modelName(model)} ${model.provider} ${model.id}`} onSelect={() => selectModel(model)}>
                    <div class="flex min-w-0 flex-1 items-center gap-2">
                      <span class="flex size-7 shrink-0 items-center justify-center rounded-xl border bg-secondary/50 text-xs font-semibold uppercase">
                        {provider.slice(0, 2)}
                      </span>
                      <ModelSelector.Name>
                        <span class="block truncate">{modelName(model)}</span>
                        <span class="block truncate font-mono text-[0.7rem] font-normal text-muted-foreground">{model.provider}/{model.id}</span>
                      </ModelSelector.Name>
                    </div>
                    {#if isCurrent(model)}
                      <ModelSelector.Shortcut>current</ModelSelector.Shortcut>
                    {:else if contextLabel(model)}
                      <ModelSelector.Shortcut>{contextLabel(model)}</ModelSelector.Shortcut>
                    {/if}
                  </ModelSelector.Item>
                {/each}
              </ModelSelector.Group>
            {/each}
          </ModelSelector.List>
        </ModelSelector.Content>
      </ModelSelector.ModelSelector>
    </Card.Content>
  </Card.Root>

  {#if !appState.models.available.length}
    <div class="rounded-2xl border border-dashed bg-secondary/20 p-4 text-sm text-muted-foreground">
      Loading available models… Use Refresh if the list does not appear.
    </div>
  {:else}
    <div class="grid gap-2">
      {#each modelGroups as [provider, models] (provider)}
        <div class="grid gap-2">
          <h3 class="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{provider}</h3>
          {#each models as model (modelKey(model))}
            <Button
              variant={isCurrent(model) ? 'secondary' : 'outline'}
              class={cn('h-auto justify-start rounded-2xl px-3 py-3 text-left', isCurrent(model) && 'border-primary/40 bg-primary/10')}
              aria-current={isCurrent(model) ? 'true' : undefined}
              onclick={() => selectModel(model)}
            >
              <span class="flex min-w-0 flex-1 flex-col items-start">
                <span class="flex max-w-full items-center gap-2">
                  <span class="truncate font-medium">{modelName(model)}</span>
                  {#if isCurrent(model)}
                    <Badge variant="outline" class="bg-primary/10 text-[0.65rem] text-primary"><Check class="mr-1 size-3" aria-hidden="true" /> current</Badge>
                  {/if}
                </span>
                <span class="mt-1 truncate font-mono text-xs font-normal text-muted-foreground">{model.provider}/{model.id}</span>
                {#if contextLabel(model)}
                  <span class="mt-1 text-xs font-normal text-muted-foreground">{contextLabel(model)}</span>
                {/if}
              </span>
            </Button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</section>
