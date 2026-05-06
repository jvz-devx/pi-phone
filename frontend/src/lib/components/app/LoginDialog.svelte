<script lang="ts">
  import { tick } from 'svelte';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
  import { submitLoginToken, type PhoneLoginClient } from '$lib/actions/auth';
  import { phoneClient, readStoredToken } from '$lib/pi-phone-transport';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';

  interface Props {
    stateStore?: PhoneStateStore;
    client?: PhoneLoginClient;
    booted?: boolean;
  }

  let { stateStore = piPhoneState, client = phoneClient, booted = false }: Props = $props();

  let appState = $derived($stateStore);
  let dialogOpen = $state(false);
  let tokenInput = $state('');
  let localError = $state('');
  let busy = $state(false);
  let required = $derived(Boolean(appState.auth.loginOpen || appState.connection.connectionState === 'auth-required'));
  let canDismiss = $derived(Boolean(booted && !appState.auth.health?.hasToken && appState.connection.connectionState !== 'auth-required'));
  let errorText = $derived(localError || appState.auth.authError);
  let tokenRef = $state<HTMLInputElement | null>(null);
  let previousRequired = $state(false);
  let previousDialogOpen = $state(false);

  async function focusTokenInput(select = false) {
    await tick();
    tokenRef?.focus();
    if (select) tokenRef?.select();
  }

  function seedTokenInput() {
    tokenInput = appState.auth.token || readStoredToken();
  }

  async function handleSubmit() {
    if (busy) return;

    busy = true;
    localError = '';
    const result = await submitLoginToken(tokenInput, { client, stateStore, connect: true });
    busy = false;

    if (result.ok) {
      tokenInput = '';
      dialogOpen = false;
      return;
    }

    localError = result.error;
    await focusTokenInput(true);
  }

  function continueWithoutToken() {
    if (!canDismiss) return;
    localError = '';
    stateStore.clearAuthError();
    stateStore.setLoginOpen(false);
    dialogOpen = false;
  }

  $effect(() => {
    if (required && !previousRequired) {
      seedTokenInput();
      localError = '';
      dialogOpen = true;
      void focusTokenInput(true);
    }

    if (!required && previousRequired) {
      localError = '';
      dialogOpen = false;
    }

    previousRequired = required;
  });

  $effect(() => {
    if (previousDialogOpen && !dialogOpen && required) {
      if (canDismiss) {
        continueWithoutToken();
      } else {
        dialogOpen = true;
        void focusTokenInput();
      }
    }

    previousDialogOpen = dialogOpen;
  });
</script>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="max-w-md gap-5 rounded-3xl border bg-card p-5 shadow-md sm:max-w-md" showCloseButton={canDismiss} aria-describedby="login-description">
    <Dialog.Header>
      <div class="flex items-start gap-3">
        <span class="rounded-2xl border border-primary/25 bg-primary/10 p-2.5 text-primary" aria-hidden="true">
          <LockKeyhole class="size-5" />
        </span>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Pi Phone</p>
          <Dialog.Title class="mt-1 text-2xl font-semibold">Access token required</Dialog.Title>
          <Dialog.Description id="login-description" class="mt-2 text-sm leading-6 text-muted-foreground">
            Enter the token printed by <code class="rounded bg-secondary px-1.5 py-0.5">/phone-start</code>. Invalid or expired tokens reopen this dialog.
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    <form class="grid gap-4" onsubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
      <div class="grid gap-2">
        <label class="text-sm font-medium" for="token-input">Access token</label>
        <Input
          id="token-input"
          bind:ref={tokenRef}
          class="h-11 rounded-xl bg-background px-3"
          type="password"
          bind:value={tokenInput}
          placeholder="Paste token"
          autocomplete="one-time-code"
          aria-invalid={Boolean(errorText)}
          aria-describedby={errorText ? 'login-token-error login-description' : 'login-description'}
          disabled={busy}
        />
      </div>

      {#if errorText}
        <p id="login-token-error" class="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{errorText}</span>
        </p>
      {/if}

      <Dialog.Footer class="gap-2 sm:justify-end">
        {#if canDismiss}
          <Button type="button" variant="ghost" onclick={continueWithoutToken}>Continue without token</Button>
        {/if}
        <Button class="min-w-24" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
