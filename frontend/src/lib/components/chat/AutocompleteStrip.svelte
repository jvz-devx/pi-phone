<script lang="ts">
  import * as Suggestions from '$lib/components/ai-elements/suggestion/index.js';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneAutocompleteItem } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    selectedIndex?: number;
    onSelect?: (item: PhoneAutocompleteItem, index: number) => void;
    class?: string;
  }

  let { stateStore = piPhoneState, selectedIndex = -1, onSelect, class: className = '' }: Props = $props();
  let appState = $derived($stateStore);

  function suggestionId(index: number) {
    return `composer-suggestion-${index}`;
  }
</script>

{#if appState.autocomplete.items.length}
  <div id="composer-suggestions" role="listbox" aria-label="Composer suggestions">
    <Suggestions.Suggestions class={cn('pb-2', className)} aria-label="Composer suggestions">
      {#each appState.autocomplete.items as item, index (`${item.kind}-${item.name || item.value || item.label}-${index}`)}
        <Suggestions.Suggestion
          id={suggestionId(index)}
          suggestion={item.label}
          variant={index === selectedIndex ? 'default' : 'outline'}
          class={cn('max-w-64 justify-start gap-2 text-left', index === selectedIndex && 'shadow-sm')}
          title={item.title || item.description || item.label}
          role="option"
          aria-selected={index === selectedIndex}
          aria-current={index === selectedIndex ? 'true' : undefined}
          aria-label={`${item.label}${item.badge ? `, ${item.badge}` : ''}`}
          onclick={() => onSelect?.(item, index)}
        >
          <span class="truncate">{item.label}</span>
          {#if item.badge}
            <span class="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.badge}
            </span>
          {/if}
        </Suggestions.Suggestion>
      {/each}
    </Suggestions.Suggestions>
  </div>
{/if}
