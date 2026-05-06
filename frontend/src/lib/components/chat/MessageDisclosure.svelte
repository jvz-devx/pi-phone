<script lang="ts">
  import PiMarkdown from '$lib/components/chat/PiMarkdown.svelte';
  import { toDetailString } from '$lib/adapters/message-adapter';
  import { cn } from '$lib/utils';

  interface Props {
    title: string;
    value?: unknown;
    content?: string | null;
    summaryDetail?: string;
    markdown?: boolean;
    defaultOpen?: boolean;
    class?: string;
  }

  let {
    title,
    value = undefined,
    content = undefined,
    summaryDetail = '',
    markdown = false,
    defaultOpen = false,
    class: className = '',
  }: Props = $props();

  let disclosureText = $derived(content ?? toDetailString(value));
  let hasContent = $derived(String(disclosureText || '').trim().length > 0);
</script>

{#if hasContent}
  <details
    open={defaultOpen}
    class={cn(
      'group/message-disclosure mt-3 rounded-lg border bg-muted/30 text-xs shadow-sm transition-colors open:bg-muted/40',
      className,
    )}
  >
    <summary
      class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden"
    >
      <span>{title}</span>
      <span class="flex min-w-0 items-center gap-2">
        {#if summaryDetail}
          <span class="truncate text-[0.7rem] font-normal text-muted-foreground/80">{summaryDetail}</span>
        {/if}
        <span aria-hidden="true" class="text-muted-foreground/70 transition-transform group-open/message-disclosure:rotate-90">›</span>
      </span>
    </summary>

    <div class="border-t px-3 py-3">
      {#if markdown}
        <PiMarkdown content={String(disclosureText)} renderer="response" />
      {:else}
        <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 font-mono leading-relaxed text-foreground/90">{String(disclosureText)}</pre>
      {/if}
    </div>
  </details>
{/if}
