<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import * as Conversation from '$lib/components/ai-elements/conversation/index.js';
  import { Loader } from '$lib/components/ai-elements/loader/index.js';
  import { Shimmer } from '$lib/components/ai-elements/shimmer/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { conversationItems } from '$lib/adapters/message-adapter';
  import { shouldShowJumpToLatest } from '$lib/actions/mobile-layout';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneUiMessage } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';
  import ChatMessage from './ChatMessage.svelte';

  const NEAR_BOTTOM_THRESHOLD = 120;
  const STREAM_FOLLOW_INTERVAL_MS = 320;
  const STREAM_FOLLOW_MIN_HEIGHT_DELTA = 16;
  const PROGRAMMATIC_SCROLL_GUARD_MS = 700;
  const USER_SCROLL_INTENT_MS = 400;
  const JUMP_LATEST_EVENT = 'pi-phone:jump-latest';
  const VIEWPORT_CHANGE_EVENT = 'pi-phone:viewport-change';

  type PendingMessageScroll = {
    force: boolean;
    streaming: boolean;
    behavior: ScrollBehavior;
  };

  interface Props {
    stateStore?: PhoneStateStore;
    class?: string;
    bottomReserve?: number;
    emptyTitle?: string;
    emptyDescription?: string;
  }

  let {
    stateStore = piPhoneState,
    class: className = '',
    bottomReserve = 0,
    emptyTitle = 'Ready',
    emptyDescription =
      'This phone UI exposes Pi commands, models, thinking, sessions, tree history, custom extension messages, and image upload.',
  }: Props = $props();

  let scrollElement: HTMLDivElement | null = $state(null);
  let contentElement: HTMLDivElement | null = $state(null);
  let nearBottom = $state(true);
  let pendingMessageScroll: PendingMessageScroll = { force: false, streaming: false, behavior: 'smooth' };
  let messageScrollFrame = 0;
  let lastContentSignature = '';

  let appState = $derived($stateStore);
  let renderedItems = $derived.by(() =>
    conversationItems(appState.messages.items, appState.tools.live, appState.messages.liveAssistant),
  );
  let hasLiveContent = $derived(
    Boolean(appState.messages.liveAssistant?.live) || [...appState.tools.live.values()].some((tool) => Boolean(tool.live)),
  );
  let hasRenderableContent = $derived(Boolean(renderedItems.length));
  let contentSignature = $derived(renderedItems.map(itemSignature).join('\n'));
  let jumpToLatestVisible = $derived(shouldShowJumpToLatest(hasRenderableContent, appState.messages.followLatest, nearBottom));
  let bottomPadding = $derived(`calc(${Math.max(0, bottomReserve)}px + env(safe-area-inset-bottom))`);
  let loadingConversation = $derived(
    !hasRenderableContent &&
      ['health-loading', 'connecting', 'reconnecting'].includes(appState.connection.connectionState),
  );
  let errorText = $derived(!hasRenderableContent ? appState.auth.authError || appState.connection.lastError || appState.status?.lastError || '' : '');

  function itemSignature(item: PhoneUiMessage) {
    const text = item.text || '';
    const thinking = item.kind === 'assistant' ? item.thinking || '' : '';
    const toolStatus = item.kind === 'tool' ? item.status : '';
    const toolCallCount = item.kind === 'assistant' ? item.toolCalls?.length || 0 : 0;
    return [
      item.id,
      item.kind,
      item.live ? 'live' : 'settled',
      text.length,
      text.slice(-80),
      thinking.length,
      thinking.slice(-80),
      toolStatus,
      toolCallCount,
    ].join(':');
  }

  function isNearBottom(threshold = NEAR_BOTTOM_THRESHOLD) {
    if (!scrollElement) return true;
    return scrollElement.scrollHeight - (scrollElement.scrollTop + scrollElement.clientHeight) <= threshold;
  }

  function refreshNearBottom() {
    nearBottom = isNearBottom();
    return nearBottom;
  }

  function noteUserScrollIntent() {
    stateStore.updateScrollFlags({ lastUserScrollIntentAt: Date.now() });
  }

  function syncFollowLatestOnScroll() {
    const now = Date.now();
    const flags = stateStore.snapshot().messages;
    const fromUser = now - flags.lastUserScrollIntentAt < USER_SCROLL_INTENT_MS;

    refreshNearBottom();
    if (!fromUser && now < flags.ignoreScrollTrackingUntil) return;
    if (flags.followLatest !== nearBottom) stateStore.setFollowLatest(nearBottom);
  }

  function requestScrollToBottom({ force = false, streaming = false, behavior = 'smooth' }: Partial<PendingMessageScroll> = {}) {
    pendingMessageScroll = {
      force: pendingMessageScroll.force || force,
      streaming: pendingMessageScroll.streaming || streaming,
      behavior,
    };

    if (messageScrollFrame) return;
    messageScrollFrame = requestAnimationFrame(() => {
      messageScrollFrame = 0;
      const nextScroll = pendingMessageScroll;
      pendingMessageScroll = { force: false, streaming: false, behavior: 'smooth' };
      void tick().then(() => performScrollToBottom(nextScroll));
    });
  }

  function performScrollToBottom(nextScroll: PendingMessageScroll) {
    if (!scrollElement) return;

    refreshNearBottom();
    const flags = stateStore.snapshot().messages;
    if (!nextScroll.force && !flags.followLatest && !nearBottom) return;

    const targetTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    const scrollTop = scrollElement.scrollTop;
    const now = Date.now();
    const heightDelta = Math.abs(scrollElement.scrollHeight - flags.lastAutoFollowHeight);

    if (!nextScroll.force && nextScroll.streaming) {
      if (flags.lastAutoFollowAt && now - flags.lastAutoFollowAt < STREAM_FOLLOW_INTERVAL_MS) return;
      if (flags.lastAutoFollowHeight && heightDelta < STREAM_FOLLOW_MIN_HEIGHT_DELTA) return;
    }

    const nextFlags = {
      lastAutoFollowAt: now,
      lastAutoFollowHeight: scrollElement.scrollHeight,
      followLatest: true,
    };

    if (Math.abs(targetTop - scrollTop) < 2) {
      nearBottom = true;
      stateStore.updateScrollFlags(nextFlags);
      return;
    }

    stateStore.updateScrollFlags({
      ...nextFlags,
      ignoreScrollTrackingUntil: now + PROGRAMMATIC_SCROLL_GUARD_MS,
    });
    scrollElement.scrollTo({ top: targetTop, behavior: nextScroll.behavior });
    nearBottom = true;
  }

  function jumpToLatest() {
    stateStore.setFollowLatest(true);
    requestScrollToBottom({ force: true, behavior: 'smooth' });
  }

  function handleViewportChange() {
    refreshNearBottom();
    if (stateStore.snapshot().messages.followLatest) requestScrollToBottom({ force: true, behavior: 'auto' });
  }

  $effect(() => {
    const signature = contentSignature;
    if (signature === lastContentSignature) return;
    lastContentSignature = signature;
    if (!signature) {
      refreshNearBottom();
      return;
    }
    requestScrollToBottom({ streaming: hasLiveContent, behavior: 'smooth' });
  });

  $effect(() => {
    if (!scrollElement && !contentElement) return;

    const resizeObserver = new ResizeObserver(() => {
      refreshNearBottom();
      requestScrollToBottom({ streaming: hasLiveContent, behavior: 'smooth' });
    });

    if (scrollElement) resizeObserver.observe(scrollElement);
    if (contentElement) resizeObserver.observe(contentElement);

    return () => resizeObserver.disconnect();
  });

  onMount(() => {
    refreshNearBottom();
    window.addEventListener(JUMP_LATEST_EVENT, jumpToLatest);
    window.addEventListener(VIEWPORT_CHANGE_EVENT, handleViewportChange);
    return () => {
      window.removeEventListener(JUMP_LATEST_EVENT, jumpToLatest);
      window.removeEventListener(VIEWPORT_CHANGE_EVENT, handleViewportChange);
    };
  });

  onDestroy(() => {
    if (messageScrollFrame) cancelAnimationFrame(messageScrollFrame);
  });
</script>

<Conversation.Root class={cn('phone-chat-workspace min-h-0 rounded-3xl border bg-card/80 shadow-sm', className)}>
  <Conversation.Content
    autoStick={false}
    bind:ref={scrollElement}
    class="phone-chat-scroll min-h-0 scroll-smooth px-4 py-5 sm:px-6"
    aria-label="Conversation messages"
    tabindex={0}
    onscroll={syncFollowLatestOnScroll}
    onwheel={noteUserScrollIntent}
    ontouchmove={noteUserScrollIntent}
    onpointerdown={noteUserScrollIntent}
    onkeydown={noteUserScrollIntent}
  >
    {#if renderedItems.length}
      <div bind:this={contentElement} class="mx-auto flex w-full max-w-3xl flex-col gap-5" style:padding-bottom={bottomPadding}>
        {#each renderedItems as message (message.id)}
          <ChatMessage item={message} {stateStore} />
        {/each}
      </div>
    {:else if loadingConversation}
      <Conversation.EmptyState aria-live="polite">
        <div class="flex flex-col items-center gap-4 text-center">
          <Loader size={24} class="text-primary" aria-hidden="true" />
          <div class="space-y-2">
            <Shimmer as="h3" class="text-sm font-medium" content_length={24}>Loading Pi conversation…</Shimmer>
            <p class="max-w-md text-sm leading-6 text-muted-foreground">Connecting to the Pi Phone runtime and waiting for the latest snapshot.</p>
          </div>
        </div>
      </Conversation.EmptyState>
    {:else if errorText}
      <Conversation.EmptyState title="Unable to load conversation" description={errorText} role="alert" />
    {:else}
      <Conversation.EmptyState title={emptyTitle} description={emptyDescription} />
    {/if}
  </Conversation.Content>

  {#if jumpToLatestVisible}
    <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4" style:bottom={bottomPadding}>
      <Button
        class="pointer-events-auto gap-2 rounded-full border-border/60 bg-background/90 px-4 shadow-sm backdrop-blur hover:bg-background"
        type="button"
        variant="outline"
        size="sm"
        aria-label="Jump to latest message"
        title="Jump to latest message (J)"
        onclick={jumpToLatest}
      >
        <ArrowDown class="size-4" aria-hidden="true" />
        <span>Latest</span>
      </Button>
    </div>
  {/if}
</Conversation.Root>
