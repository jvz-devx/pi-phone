<script lang="ts">
  import { onMount } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button/index.js';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import { cn } from '$lib/utils';

  interface Props {
    stateStore?: PhoneStateStore;
    class?: string;
  }

  let { stateStore = piPhoneState, class: className = '' }: Props = $props();
  let appState = $derived($stateStore);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function syncToastTimers(toasts = stateStore.snapshot().feedback.toasts) {
    const activeIds = new Set(toasts.map((toast) => toast.id));

    for (const [id, timer] of timers) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }

    for (const toast of toasts) {
      if (timers.has(toast.id)) continue;
      const elapsed = Date.now() - toast.createdAt;
      const delay = Math.max(0, toast.ttlMs - elapsed);
      timers.set(
        toast.id,
        setTimeout(() => {
          timers.delete(toast.id);
          stateStore.dismissToast(toast.id);
        }, delay),
      );
    }
  }

  function clearToastTimers() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  onMount(() => {
    const unsubscribe = stateStore.subscribe((nextState) => syncToastTimers(nextState.feedback.toasts));
    return () => {
      unsubscribe();
      clearToastTimers();
    };
  });
</script>

{#if appState.feedback.toasts.length}
  <div class={cn('pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[70] mx-auto flex w-full max-w-md flex-col gap-2 px-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm sm:px-0', className)} aria-live="polite" aria-atomic="false">
    {#each appState.feedback.toasts as toast (toast.id)}
      <div
        class={cn(
          'pointer-events-auto flex items-start gap-3 rounded-2xl border bg-popover/95 p-3 text-sm text-popover-foreground shadow-md backdrop-blur',
          toast.kind === 'error'
            ? 'border-destructive/40 text-destructive'
            : toast.kind === 'warning'
              ? 'border-amber-300/35 text-amber-100'
              : toast.kind === 'success'
                ? 'border-emerald-400/35 text-emerald-100'
                : 'border-border',
        )}
        role={toast.kind === 'error' ? 'alert' : 'status'}
      >
        <span class="min-w-0 flex-1">{toast.text}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss notification" onclick={() => stateStore.dismissToast(toast.id)}>
          <X class="size-3" aria-hidden="true" />
        </Button>
      </div>
    {/each}
  </div>
{/if}
