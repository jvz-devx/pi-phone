<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Square from '@lucide/svelte/icons/square';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import * as PromptInput from '$lib/components/ai-elements/prompt-input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    abortGeneration,
    canSteer,
    submitPrompt,
    type PhoneCommandActionClient,
  } from '$lib/actions/phone-commands';
  import {
    addImageAttachments,
    clearComposerAttachments,
    orderedAttachments,
    registerAttachmentObjectUrlCleanup,
    removeAttachmentAndToken,
    syncAttachmentsWithPrompt,
    type TextEditResult,
  } from '$lib/actions/attachments';
  import {
    applyAutocompleteItem,
    moveAutocompleteSelection,
    updateAutocomplete,
    type PhoneAutocompleteClient,
  } from '$lib/actions/autocomplete';
  import { phoneClient } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PromptInputAttachmentData } from '$lib/components/ai-elements/prompt-input/index.js';
  import type { PhoneAutocompleteItem } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';
  import AttachmentTray from './AttachmentTray.svelte';
  import AutocompleteStrip from './AutocompleteStrip.svelte';
  import ComposerMeta from './ComposerMeta.svelte';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneCommandActionClient & PhoneAutocompleteClient;
    class?: string;
    autofocus?: boolean;
  }

  let { stateStore = piPhoneState, client = phoneClient, class: className = '', autofocus = false }: Props = $props();

  let textarea: HTMLTextAreaElement | null = $state(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let text = $state('');
  let promptInputAttachments = $state<PromptInputAttachmentData[]>([]);
  let selectedSuggestionIndex = $state(-1);
  let cleanupBeforeUnload: (() => void) | null = null;
  let appState = $derived($stateStore);
  let streaming = $derived(Boolean(appState.status?.isStreaming || appState.snapshot.state?.isStreaming));
  let steerVisible = $derived(canSteer(appState) && text.trim().length > 0);
  let ordered = $derived(orderedAttachments(appState.attachments.items, text));
  let canSubmit = $derived(Boolean(text.trim() || appState.attachments.items.length));

  $effect(() => {
    const storeText = appState.composer.text;
    const activeElement = typeof document === 'undefined' ? null : document.activeElement;
    if (storeText !== text && (!textarea || textarea !== activeElement)) text = storeText;
  });

  $effect(() => {
    if (stateStore.snapshot().composer.text !== text) stateStore.setComposerText(text);
  });

  $effect(() => {
    if (selectedSuggestionIndex >= appState.autocomplete.items.length) {
      selectedSuggestionIndex = appState.autocomplete.items.length ? appState.autocomplete.items.length - 1 : -1;
    }
  });

  $effect(() => {
    stateStore.updateComposer({ steerAvailable: canSteer(appState) });
  });

  $effect(() => {
    if (!autofocus || !textarea) return;
    textarea.focus();
  });

  function selection() {
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    return { start, end };
  }

  function scheduleCursor(edit: Pick<TextEditResult, 'selectionStart' | 'selectionEnd'> | { cursor: number }) {
    void tick().then(() => {
      if (!textarea) return;
      const start = 'cursor' in edit ? edit.cursor : edit.selectionStart;
      const end = 'cursor' in edit ? edit.cursor : edit.selectionEnd;
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  function syncAutocomplete() {
    const cursor = textarea?.selectionStart ?? text.length;
    const context = updateAutocomplete(text, cursor, { store: stateStore, client });
    if (!context) selectedSuggestionIndex = -1;
    else if (selectedSuggestionIndex < 0 && stateStore.snapshot().autocomplete.items.length) selectedSuggestionIndex = 0;
  }

  function handleInput() {
    stateStore.setComposerText(text);
    syncAttachmentsWithPrompt(text, { store: stateStore });
    syncAutocomplete();
  }

  function handleSelectSuggestion(item: PhoneAutocompleteItem) {
    const result = applyAutocompleteItem(item, {
      text,
      cursor: textarea?.selectionStart ?? text.length,
      context: stateStore.snapshot().autocomplete.context,
      store: stateStore,
      client,
    });
    if (!result.handled) return;
    text = result.text;
    selectedSuggestionIndex = -1;
    scheduleCursor({ cursor: result.cursor });
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    const items = appState.autocomplete.items;
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedSuggestionIndex = moveAutocompleteSelection(selectedSuggestionIndex, items.length, 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedSuggestionIndex = moveAutocompleteSelection(selectedSuggestionIndex, items.length, -1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      selectedSuggestionIndex = -1;
      stateStore.clearAutocomplete();
      return;
    }

    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      const index = selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0;
      const item = items[index];
      if (!item) return;
      event.preventDefault();
      handleSelectSuggestion(item);
    }
  }

  async function handleSubmit(steer = false) {
    stateStore.setComposerText(text);
    const result = await submitPrompt({ store: stateStore, client, steer });
    if (result.status === 'sent' || result.status === 'handled') {
      text = '';
      selectedSuggestionIndex = -1;
      scheduleCursor({ cursor: 0 });
    }
  }

  function handlePromptSubmit() {
    if (!canSubmit) return;
    void handleSubmit(false);
  }

  function handleSteer() {
    if (!steerVisible) return;
    void handleSubmit(true);
  }

  function handleAbort() {
    abortGeneration({ client, store: stateStore });
  }

  function chooseImages() {
    fileInput?.click();
  }

  function applyAddedFiles(files: File[] | FileList | Iterable<File> | null | undefined) {
    const result = addImageAttachments(files, { store: stateStore, text, selection: selection() });
    if (result.textEdit) {
      text = result.textEdit.text;
      scheduleCursor(result.textEdit);
    }
  }

  function handleFileInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    applyAddedFiles(input.files);
    input.value = '';
  }

  function handlePromptInputFileAdd(added: PromptInputAttachmentData[]) {
    applyAddedFiles(added.map((attachment) => attachment.file));
    promptInputAttachments = [];
  }

  function removeAttachment(id: string) {
    const result = removeAttachmentAndToken(id, { store: stateStore, text, selection: selection() });
    if (result.textEdit) {
      text = result.textEdit.text;
      scheduleCursor(result.textEdit);
    }
  }

  onMount(() => {
    cleanupBeforeUnload = registerAttachmentObjectUrlCleanup(stateStore);
  });

  onDestroy(() => {
    cleanupBeforeUnload?.();
    clearComposerAttachments(stateStore, { text });
  });
</script>

<section class={cn('phone-composer-bar rounded-3xl border bg-card/95 p-3 shadow-2xl backdrop-blur', className)} aria-label="Message composer">
  <ComposerMeta stateStore={stateStore} class="mb-2 lg:hidden" />

  <AutocompleteStrip
    stateStore={stateStore}
    selectedIndex={selectedSuggestionIndex}
    onSelect={(item) => handleSelectSuggestion(item)}
  />

  <AttachmentTray attachments={ordered} promptText={text} onRemove={removeAttachment} class="mb-2" />

  <input bind:this={fileInput} class="hidden" type="file" accept="image/*" multiple onchange={handleFileInput} />

  <div onkeydowncapture={handleComposerKeydown}>
    <PromptInput.Root
      class="border-border/70 bg-background/90 shadow-none"
      accept="image/*"
      multiple
      bind:attachments={promptInputAttachments}
      clearOnSubmit={false}
      onFileAdd={handlePromptInputFileAdd}
      onSubmit={handlePromptSubmit}
    >
      <PromptInput.Body>
        <PromptInput.Textarea
          bind:ref={textarea}
          bind:value={text}
          placeholder={streaming ? 'Queue a follow-up, or use Steer to guide the current response…' : 'Message Pi…'}
          aria-label="Prompt"
          oninput={handleInput}
          onkeyup={syncAutocomplete}
          onclick={syncAutocomplete}
        />
      </PromptInput.Body>
      <PromptInput.Toolbar class="gap-2 border-t px-2 py-2">
        <PromptInput.Tools class="gap-2">
          <Button type="button" variant="outline" size="sm" class="gap-2 rounded-xl" onclick={chooseImages}>
            <ImagePlus class="size-4" aria-hidden="true" />
            Attach
          </Button>
          {#if steerVisible}
            <Button type="button" variant="secondary" size="sm" class="gap-2 rounded-xl" onclick={handleSteer} aria-label="Steer current response">
              <WandSparkles class="size-4" aria-hidden="true" />
              Steer
            </Button>
          {/if}
        </PromptInput.Tools>
        <div class="ml-auto flex items-center gap-2">
          {#if streaming}
            <Button type="button" variant="destructive" size="sm" class="gap-2 rounded-xl" onclick={handleAbort} aria-label="Stop current response">
              <Square class="size-3.5" aria-hidden="true" />
              Stop
            </Button>
          {/if}
          <PromptInput.Submit status="ready" class="rounded-xl" disabled={!canSubmit || appState.composer.isSubmitting} title={streaming ? 'Queue follow-up message' : 'Send message'} />
        </div>
      </PromptInput.Toolbar>
    </PromptInput.Root>
  </div>
</section>
