<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';
  import type { PhoneSessionSummary } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';

  interface Props {
    title: string;
    sessions: PhoneSessionSummary[];
    empty: string;
    class?: string;
    onSelect: (session: PhoneSessionSummary) => void;
    sessionLabel: (session: PhoneSessionSummary) => string;
    sessionPreview: (session: PhoneSessionSummary) => string;
    sessionMeta: (session: PhoneSessionSummary) => string;
    isCurrent: (session: PhoneSessionSummary) => boolean;
  }

  let {
    title,
    sessions,
    empty,
    class: className = '',
    onSelect,
    sessionLabel,
    sessionPreview,
    sessionMeta,
    isCurrent,
  }: Props = $props();
</script>

<section class={className} aria-label={`${title} sessions`}>
  <div class="mb-2 flex items-center justify-between gap-2">
    <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
    <Badge variant="outline" class="bg-background/60 text-[0.65rem] text-muted-foreground">{sessions.length}</Badge>
  </div>

  {#if sessions.length}
    <div class="grid gap-2">
      {#each sessions as session (session.id)}
        <button
          type="button"
          class={cn(
            'group w-full rounded-2xl border bg-background/45 p-3 text-left transition hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isCurrent(session) && 'border-primary/45 bg-primary/10',
            session.hasPendingUiRequest && 'border-amber-400/45 bg-amber-500/10',
          )}
          aria-current={isCurrent(session) ? 'page' : undefined}
          onclick={() => onSelect(session)}
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{sessionLabel(session)}</div>
              <div class="mt-1 truncate text-xs text-muted-foreground">{sessionMeta(session)}</div>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              {#if isCurrent(session)}
                <Badge class="h-5 bg-primary/90 text-[0.65rem]">current</Badge>
              {/if}
              {#if session.isStreaming}
                <Badge variant="outline" class="border-emerald-400/40 bg-emerald-500/10 text-[0.65rem] text-emerald-200">live</Badge>
              {/if}
              {#if session.hasPendingUiRequest}
                <Badge variant="outline" class="border-amber-400/40 bg-amber-500/10 text-[0.65rem] text-amber-100">input</Badge>
              {/if}
            </div>
          </div>

          {#if sessionPreview(session)}
            <p class="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{sessionPreview(session)}</p>
          {/if}

          {#if session.kind === 'parent' && session.commandContextAvailable === false}
            <p class="mt-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">Command controls unavailable</p>
          {/if}
          {#if session.lastError}
            <p class="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{session.lastError}</p>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="rounded-2xl border border-dashed bg-secondary/25 p-3 text-xs leading-5 text-muted-foreground">{empty}</div>
  {/if}
</section>
