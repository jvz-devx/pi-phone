<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import type { PhoneExtensionUiClient } from '$lib/actions/extension-ui';
  import {
    extensionUiDraftValue,
    persistExtensionUiDraft,
    sendExtensionUiResponse,
  } from '$lib/actions/extension-ui';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneExtensionUiRequest } from '$lib/types/pi-phone';

  interface Props {
    request: PhoneExtensionUiRequest;
    stateStore?: PhoneStateStore;
    client?: PhoneExtensionUiClient;
  }

  let { request, stateStore = piPhoneState, client }: Props = $props();

  let draft = $state(initialDraftValue());
  let editorRef = $state<HTMLTextAreaElement | null>(null);

  function initialDraftValue() {
    return extensionUiDraftValue(stateStore.snapshot(), request);
  }

  let placeholder = $derived(typeof (request as { placeholder?: unknown }).placeholder === 'string' ? String((request as { placeholder?: unknown }).placeholder) : 'Write your response…');
  let title = $derived(request.title || 'Edit text');
  let message = $derived(request.message || 'Review or edit the text below, then submit it to the extension.');

  onMount(() => {
    void tick().then(() => editorRef?.focus());
  });

  function updateDraft(value: string) {
    draft = value;
    persistExtensionUiDraft(request, value, { store: stateStore });
  }

  function submit() {
    if (request.id == null) return;
    sendExtensionUiResponse({ id: request.id, value: draft }, { store: stateStore, client });
  }

  function cancel() {
    if (request.id == null) return;
    sendExtensionUiResponse({ id: request.id, cancelled: true }, { store: stateStore, client });
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col bg-card text-card-foreground">
  <header class="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
    <div class="min-w-0">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extension editor</p>
      <h2 class="mt-1 text-lg font-semibold leading-tight sm:text-xl">{title}</h2>
      {#if message}
        <p class="mt-1 text-sm leading-6 text-muted-foreground">{message}</p>
      {/if}
    </div>
    <Button type="button" variant="outline" size="sm" onclick={cancel} aria-label="Cancel extension editor request">Cancel</Button>
  </header>

  <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-5">
    <label class="sr-only" for="extension-editor-text">Editor response</label>
    <Textarea
      id="extension-editor-text"
      bind:ref={editorRef}
      bind:value={draft}
      class="min-h-[calc(100dvh-12rem)] flex-1 resize-none rounded-2xl border bg-background/80 p-4 font-mono text-sm leading-6 sm:min-h-[28rem]"
      {placeholder}
      spellcheck="false"
      oninput={(event) => updateDraft(event.currentTarget.value)}
      onkeydown={handleKeydown}
      aria-describedby="extension-editor-help"
    />
    <div id="extension-editor-help" class="flex shrink-0 flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>Draft is kept for this request until you submit or cancel. Press Ctrl/⌘ Enter to submit.</span>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={cancel} aria-label="Cancel extension editor request">Cancel</Button>
        <Button type="button" onclick={submit} aria-label="Submit extension editor response">Submit</Button>
      </div>
    </div>
  </div>
</div>
