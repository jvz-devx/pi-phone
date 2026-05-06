<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { orderedAttachments } from '$lib/actions/attachments';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { PhoneAttachmentRecord } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';

  interface Props {
    attachments?: PhoneAttachmentRecord[];
    promptText?: string;
    class?: string;
    onRemove?: (id: string) => void;
  }

  let { attachments = [], promptText = '', class: className = '', onRemove }: Props = $props();

  let ordered = $derived(orderedAttachments(attachments, promptText));

  function formatBytes(size: number) {
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }
</script>

{#if ordered.length}
  <div class={cn('grid gap-2 px-2 pb-2 sm:grid-cols-2', className)} aria-label="Attached images">
    {#each ordered as attachment (attachment.id)}
      <article class="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border/70 bg-secondary/35 p-2 shadow-sm">
        <img
          class="size-16 rounded-xl border border-border/70 bg-background object-cover"
          src={attachment.url}
          alt={attachment.name ? `Preview of ${attachment.name}` : `Preview of ${attachment.token}`}
        />
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-primary">
              {attachment.token}
            </span>
            <span class="text-[0.7rem] uppercase tracking-wide text-muted-foreground">image</span>
          </div>
          <p class="mt-1 truncate text-sm font-medium" title={attachment.name}>{attachment.name || 'Image attachment'}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{formatBytes(attachment.size)}</p>
        </div>
        <Button
          class="size-8 rounded-full opacity-90 transition group-hover:opacity-100"
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove image ${attachment.token}`}
          onclick={() => onRemove?.(attachment.id)}
        >
          <X class="size-4" aria-hidden="true" />
        </Button>
      </article>
    {/each}
  </div>
{/if}
