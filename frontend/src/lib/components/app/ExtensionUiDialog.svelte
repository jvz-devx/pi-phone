<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import {
    Confirmation,
    ConfirmationAction,
    ConfirmationActions,
    ConfirmationRequest,
    ConfirmationTitle,
  } from '$lib/components/ai-elements/confirmation/index.js';
  import type { PhoneExtensionUiClient, ExtensionUiResponsePayload } from '$lib/actions/extension-ui';
  import {
    extensionUiDraftValue,
    extensionUiRequestKey,
    isExtensionUiRequestOwnedByActiveSession,
    persistExtensionUiDraft,
    sendExtensionUiResponse,
  } from '$lib/actions/extension-ui';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneExtensionUiRequest } from '$lib/types/pi-phone';
  import ExtensionEditorRequest from './ExtensionEditorRequest.svelte';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneExtensionUiClient;
  }

  let { stateStore = piPhoneState, client }: Props = $props();

  let appState = $derived($stateStore);
  let request = $derived(appState.uiRequests.pending);
  let requestKey = $derived(extensionUiRequestKey(request));
  let ownedByActiveSession = $derived(isExtensionUiRequestOwnedByActiveSession(appState, request));
  let isActionableRequest = $derived(Boolean(request && ['select', 'confirm', 'input', 'editor'].includes(request.method)));
  let dialogOpen = $state(false);
  let activeDialogKey = $state('');
  let responding = $state(false);
  let draft = $state('');
  let selectedValue = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);
  let selectRef = $state<HTMLSelectElement | null>(null);

  type ExtensionStatusWidget = { key: string; lines: string[] };

  let title = $derived(request?.title || 'Action required');
  let message = $derived(request?.message || 'An extension is waiting for your response.');
  let options = $derived(selectOptions(request));
  let placeholder = $derived(typeof (request as { placeholder?: unknown } | null)?.placeholder === 'string' ? String((request as { placeholder?: unknown }).placeholder) : 'Type your response…');
  let footerStatus = $derived(appState.uiRequests.footerStatus.trim());
  let statusWidgets = $derived.by<ExtensionStatusWidget[]>(() =>
    [...appState.uiRequests.widgets.entries()]
      .map(([key, lines]) => ({ key, lines: lines.filter((line) => line.trim()) }))
      .filter((widget) => widget.lines.length > 0),
  );
  let showStatusPanel = $derived(Boolean(footerStatus || statusWidgets.length));

  function selectOptions(value: PhoneExtensionUiRequest | null) {
    if (!value || value.method !== 'select' || !Array.isArray(value.options)) return [];
    return value.options.filter((option): option is string => typeof option === 'string');
  }

  function syncDialogWithState(nextState = stateStore.snapshot()) {
    const nextRequest = nextState.uiRequests.pending;
    const nextOwnedByActiveSession = isExtensionUiRequestOwnedByActiveSession(nextState, nextRequest);
    const nextActionableRequest = Boolean(nextRequest && ['select', 'confirm', 'input', 'editor'].includes(nextRequest.method));
    const nextRequestKey = extensionUiRequestKey(nextRequest);
    const nextOptions = selectOptions(nextRequest);

    if (nextRequest && !nextOwnedByActiveSession) {
      stateStore.clearPendingUiRequest();
      stateStore.pushToast('That UI request belongs to another session.', 'error');
      return;
    }

    if (!nextRequest || !nextActionableRequest) {
      activeDialogKey = '';
      responding = false;
      dialogOpen = false;
      return;
    }

    if (nextRequestKey && nextRequestKey !== activeDialogKey) {
      activeDialogKey = nextRequestKey;
      responding = false;
      draft = extensionUiDraftValue(nextState, nextRequest);
      selectedValue = nextOptions[0] || '';
      dialogOpen = true;
      void tick().then(() => {
        if (nextRequest.method === 'input') inputRef?.focus();
        if (nextRequest.method === 'select') selectRef?.focus();
      });
    }
  }

  function getDialogOpen() {
    return dialogOpen;
  }

  function setDialogOpen(nextOpen: boolean) {
    if (dialogOpen === nextOpen) return;
    dialogOpen = nextOpen;
    if (!nextOpen && request && activeDialogKey && !responding) cancelRequest();
  }

  onMount(() => stateStore.subscribe((nextState) => syncDialogWithState(nextState)));

  function respond(payload: ExtensionUiResponsePayload) {
    responding = true;
    const sent = sendExtensionUiResponse(payload, { store: stateStore, client });
    if (!sent) {
      responding = false;
      if (stateStore.snapshot().uiRequests.pending) dialogOpen = true;
    }
    return sent;
  }

  function cancelRequest() {
    if (!request || request.id == null) return;
    respond({ id: request.id, cancelled: true });
  }

  function submitInput() {
    if (!request || request.id == null) return;
    respond({ id: request.id, value: draft });
  }

  function submitSelect(value = selectedValue) {
    if (!request || request.id == null || !value) return;
    respond({ id: request.id, value });
  }

  function submitConfirm(confirmed: boolean) {
    if (!request || request.id == null) return;
    respond({ id: request.id, confirmed });
  }

  function updateDraft(value: string) {
    draft = value;
    persistExtensionUiDraft(request, value, { store: stateStore });
  }

  function handleInput(event: Event) {
    updateDraft((event.currentTarget as HTMLInputElement).value);
  }

  function handleSelectChange(event: Event) {
    selectedValue = (event.currentTarget as HTMLSelectElement).value;
  }
</script>

{#if showStatusPanel}
  <aside
    class="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 mx-auto max-w-xl rounded-2xl border border-primary/20 bg-card/95 p-3 text-card-foreground shadow-md backdrop-blur sm:inset-x-auto sm:right-4 sm:w-80"
    aria-label="Extension status"
    aria-live="polite"
    role="status"
  >
    <div class="grid gap-3">
      {#if footerStatus}
        <div class="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
          <p class="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-primary">Extension status</p>
          <p class="mt-1 text-sm leading-5">{footerStatus}</p>
        </div>
      {/if}

      {#each statusWidgets as widget (widget.key)}
        <section class="rounded-xl border bg-background/80 px-3 py-2" aria-label={`Extension widget ${widget.key}`}>
          <p class="break-all font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{widget.key}</p>
          <ul class="mt-1 grid gap-1 text-sm leading-5">
            {#each widget.lines as line}
              <li class="break-words">{line}</li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </aside>
{/if}

{#if request && isActionableRequest && ownedByActiveSession}
  <Dialog.Root bind:open={getDialogOpen, setDialogOpen}>
    {#if request.method === 'editor'}
      <Dialog.Content
        class="inset-0 left-0 top-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none p-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(82dvh,52rem)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        showCloseButton={false}
        aria-label={title}
      >
        {#key requestKey}
          <ExtensionEditorRequest {request} {stateStore} {client} />
        {/key}
      </Dialog.Content>
    {:else}
      <Dialog.Content class="max-w-[calc(100%-1.5rem)] rounded-2xl p-0 sm:max-w-lg" showCloseButton={false} aria-label={title} aria-describedby="extension-request-description">
        <div class="rounded-2xl border bg-card text-card-foreground shadow-md">
          <Dialog.Header class="border-b px-5 py-4">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extension request</p>
            <Dialog.Title class="mt-1 text-xl font-semibold">{title}</Dialog.Title>
            {#if message}
              <Dialog.Description id="extension-request-description" class="mt-2 text-sm leading-6 text-muted-foreground">{message}</Dialog.Description>
            {/if}
            {#if request.sessionWorkerId}
              <p class="mt-2 break-all font-mono text-[0.7rem] text-muted-foreground">Session {request.sessionWorkerId}</p>
            {/if}
          </Dialog.Header>

          {#if request.method === 'confirm'}
            <div class="p-5">
              <Confirmation approval={{ id: String(request.id) }} state="approval-requested" class="border-primary/25 bg-primary/5">
                <ConfirmationTitle>{title}</ConfirmationTitle>
                <ConfirmationRequest>
                  <p class="text-sm leading-6 text-muted-foreground">{message}</p>
                </ConfirmationRequest>
                <ConfirmationActions>
                  <ConfirmationAction variant="outline" onclick={() => submitConfirm(false)} aria-label="Reject extension confirmation">No</ConfirmationAction>
                  <ConfirmationAction onclick={() => submitConfirm(true)} aria-label="Accept extension confirmation">Yes</ConfirmationAction>
                </ConfirmationActions>
              </Confirmation>
            </div>
          {:else if request.method === 'select'}
            <form class="space-y-4 p-5" onsubmit={(event) => { event.preventDefault(); submitSelect(); }}>
              {#if options.length}
                <label class="text-sm font-medium" for="extension-select-input">Choose an option</label>
                <select
                  id="extension-select-input"
                  bind:this={selectRef}
                  class="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-ring transition focus:ring-2"
                  value={selectedValue}
                  onchange={handleSelectChange}
                  aria-label="Extension request options"
                >
                  {#each options as option}
                    <option value={option}>{option}</option>
                  {/each}
                </select>
                <div class="grid gap-2 sm:grid-cols-2">
                  {#each options as option}
                    <Button type="button" variant="secondary" class="justify-start" onclick={() => submitSelect(option)} aria-label={`Choose ${option}`}>{option}</Button>
                  {/each}
                </div>
              {:else}
                <p class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">This select request did not include any options.</p>
              {/if}
              <div class="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onclick={cancelRequest} aria-label="Cancel extension select request">Cancel</Button>
                <Button type="submit" disabled={!selectedValue} aria-label="Submit selected extension option">Submit</Button>
              </div>
            </form>
          {:else if request.method === 'input'}
            <form class="space-y-4 p-5" onsubmit={(event) => { event.preventDefault(); submitInput(); }}>
              <label class="text-sm font-medium" for="extension-input-text">Response</label>
              <Input
                id="extension-input-text"
                bind:ref={inputRef}
                bind:value={draft}
                class="h-11 rounded-xl"
                {placeholder}
                oninput={handleInput}
                aria-label="Extension request response"
              />
              <p class="text-xs text-muted-foreground">Draft is kept for this request until you submit or cancel.</p>
              <div class="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onclick={cancelRequest} aria-label="Cancel extension input request">Cancel</Button>
                <Button type="submit" aria-label="Submit extension input response">Submit</Button>
              </div>
            </form>
          {/if}
        </div>
      </Dialog.Content>
    {/if}
  </Dialog.Root>
{/if}
