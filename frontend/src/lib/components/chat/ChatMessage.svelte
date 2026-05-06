<script lang="ts">
  import * as AiMessage from '$lib/components/ai-elements/message/index.js';
  import * as AiReasoning from '$lib/components/ai-elements/reasoning/index.js';
  import * as AiTool from '$lib/components/ai-elements/tool/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import MessageDisclosure from '$lib/components/chat/MessageDisclosure.svelte';
  import PiMarkdown from '$lib/components/chat/PiMarkdown.svelte';
  import ToolCallCard from '$lib/components/chat/ToolCallCard.svelte';
  import UserInlineImage from '$lib/components/chat/UserInlineImage.svelte';
  import { cn } from '$lib/utils';
  import { renderableUserContent } from '$lib/adapters/message-adapter';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { MessageRole } from '$lib/components/ai-elements/message/index.js';
  import type { PhoneUiMessage, PhoneUsage } from '$lib/types/pi-phone';

  interface Props {
    item: PhoneUiMessage;
    stateStore?: PhoneStateStore;
    class?: string;
  }

  let { item, stateStore = piPhoneState, class: className = '' }: Props = $props();

  let userParts = $derived(item.kind === 'user' ? renderableUserContent(item.rawContent, item.text || '') : []);
  let hasUserRenderedImages = $derived(userParts.some((part) => part.type === 'image'));

  function roleForMessage(message: PhoneUiMessage): MessageRole {
    if (message.kind === 'user') return 'user';
    if (message.kind === 'tool') return 'tool';
    if (message.kind === 'system') return 'system';
    return 'assistant';
  }

  function roleLabel(message: PhoneUiMessage) {
    const labels: Record<PhoneUiMessage['kind'], string> = {
      assistant: 'Pi',
      custom: message.title || 'Extension',
      summary: message.title || 'Summary',
      system: 'System',
      tool: message.title || 'Tool',
      user: 'You',
    };
    return labels[message.kind] || 'Message';
  }

  function imageCountFor(message: PhoneUiMessage) {
    return 'imageCount' in message && typeof message.imageCount === 'number' ? message.imageCount : 0;
  }

  function shouldShowImagePill(message: PhoneUiMessage) {
    if (!imageCountFor(message)) return false;
    return !(message.kind === 'user' && hasUserRenderedImages);
  }

  function emptyTextFallback(message: PhoneUiMessage) {
    if (message.kind === 'assistant' && message.toolCalls?.length) return '';
    if (message.kind === 'tool' && message.status === 'running') return 'Running…';
    return '(no text)';
  }

  function formatCount(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '';
  }

  function formatCost(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value < 0.01 ? 6 : 4,
    }).format(value);
  }

  function usageTotal(usage: PhoneUsage | undefined) {
    if (!usage) return undefined;
    const total = (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
    return total || undefined;
  }

  function usageSummary(usage: PhoneUsage | undefined) {
    if (!usage) return '';
    const parts = [
      usage.input ? `${formatCount(usage.input)} in` : '',
      usage.output ? `${formatCount(usage.output)} out` : '',
      usageTotal(usage) ? `${formatCount(usageTotal(usage))} total` : '',
      usage.cost?.total ? formatCost(usage.cost.total) : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function stopReasonSummary(reason: string | undefined) {
    if (!reason) return '';
    return reason.replace(/[-_]+/g, ' ');
  }

  function summaryKindLabel(message: PhoneUiMessage) {
    if (message.kind !== 'summary') return 'Summary';
    if (message.summaryKind === 'branch') return 'Branch';
    if (message.summaryKind === 'compaction') return 'Compaction';
    return 'Summary';
  }

  function summaryDetailsTitle(message: PhoneUiMessage) {
    if (message.kind !== 'summary') return 'Details';
    if (message.summaryKind === 'branch') return 'Branch details';
    if (message.summaryKind === 'compaction') return 'Compaction details';
    return 'Details';
  }
</script>

<AiMessage.Message from={roleForMessage(item)} class={cn('phone-chat-message', className)} data-kind={item.kind}>
  <div class="flex items-center gap-2 px-1 text-xs text-muted-foreground group-[.is-user]:justify-end">
    <span class="rounded-full border bg-background/70 px-2 py-0.5 font-medium text-foreground/90">
      {roleLabel(item)}{item.live ? ' · live' : ''}
    </span>
    {#if item.meta}
      <span>{item.meta}</span>
    {/if}
  </div>

  <AiMessage.MessageContent
    class={cn(
      'phone-chat-message-content',
      item.kind === 'tool' && 'w-full rounded-xl border bg-card p-0',
      (item.kind === 'custom' || item.kind === 'summary' || item.kind === 'system') && 'rounded-xl border bg-card/75 p-4',
      item.kind === 'summary' && 'border-dashed bg-muted/20',
    )}
  >
    {#if item.kind === 'user'}
      {#if userParts.length}
        <div class="flex flex-col gap-3">
          {#each userParts as part}
            {#if part.type === 'text'}
              <PiMarkdown content={part.text} />
            {:else}
              <UserInlineImage {part} />
            {/if}
          {/each}
        </div>
      {:else}
        <span class="text-muted-foreground">{emptyTextFallback(item)}</span>
      {/if}
    {:else if item.kind === 'assistant'}
      {#if item.thinking}
        <AiReasoning.Reasoning isStreaming={Boolean(item.live)} defaultOpen={Boolean(item.live)} class="mb-3">
          <AiReasoning.ReasoningTrigger />
          <AiReasoning.ReasoningContent>
            <PiMarkdown content={item.thinking} live={Boolean(item.live)} renderer="response" />
          </AiReasoning.ReasoningContent>
        </AiReasoning.Reasoning>
      {/if}

      {#if item.text}
        <PiMarkdown content={item.text} live={Boolean(item.live)} />
      {:else if !item.thinking && !item.toolCalls?.length}
        <span class="text-muted-foreground">{emptyTextFallback(item)}</span>
      {/if}

      {#if item.toolCalls?.length}
        <div class="mt-3 space-y-2">
          {#each item.toolCalls as toolCall, index (toolCall.id || `${toolCall.name}-${index}`)}
            <AiTool.Tool open={false} class="mb-0 border-border/60 bg-background/55">
              <AiTool.ToolHeader type={toolCall.name || 'tool'} state="input-available" statusLabel={item.live ? 'Queued' : 'Called'} />
              <AiTool.ToolContent>
                <AiTool.ToolInput input={toolCall.arguments || {}} />
              </AiTool.ToolContent>
            </AiTool.Tool>
          {/each}
        </div>
      {/if}

      {#if item.stopReason}
        <MessageDisclosure title="Stop reason" content={item.stopReason} summaryDetail={stopReasonSummary(item.stopReason)} />
      {/if}

      {#if item.usage}
        <MessageDisclosure title="Usage" value={item.usage} summaryDetail={usageSummary(item.usage)} />
      {/if}

      {#if item.details}
        <MessageDisclosure title="Details" value={item.details} />
      {/if}
    {:else if item.kind === 'tool'}
      <ToolCallCard {item} {stateStore} />
    {:else if item.kind === 'custom'}
      <div class="space-y-3">
        {#if item.customType}
          <Badge variant="outline" class="bg-background/60 text-muted-foreground">{item.customType}</Badge>
        {/if}

        {#if item.text}
          <PiMarkdown content={item.text} />
        {:else}
          <span class="text-muted-foreground">{emptyTextFallback(item)}</span>
        {/if}

        {#if item.details}
          <MessageDisclosure title="Details" value={item.details} />
        {/if}
      </div>
    {:else if item.kind === 'summary'}
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{summaryKindLabel(item)} summary</Badge>
          {#if item.fromId}
            <Badge variant="outline" class="bg-background/60 text-muted-foreground">from {String(item.fromId)}</Badge>
          {/if}
          {#if item.tokensBefore}
            <Badge variant="outline" class="bg-background/60 text-muted-foreground">{formatCount(item.tokensBefore)} tokens before</Badge>
          {/if}
        </div>

        {#if item.text}
          <PiMarkdown content={item.text} />
        {:else}
          <span class="text-muted-foreground">{emptyTextFallback(item)}</span>
        {/if}

        {#if item.details}
          <MessageDisclosure title={summaryDetailsTitle(item)} value={item.details} />
        {/if}
      </div>
    {:else}
      {#if item.text}
        <PiMarkdown content={item.text} />
      {:else}
        <span class="text-muted-foreground">{emptyTextFallback(item)}</span>
      {/if}

      {#if item.details}
        <MessageDisclosure title="Details" value={item.details} />
      {/if}
    {/if}

    {#if shouldShowImagePill(item)}
      <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span class="rounded-full border bg-background/70 px-2 py-0.5">
          {imageCountFor(item)} image{imageCountFor(item) === 1 ? '' : 's'}
        </span>
      </div>
    {/if}
  </AiMessage.MessageContent>
</AiMessage.Message>
