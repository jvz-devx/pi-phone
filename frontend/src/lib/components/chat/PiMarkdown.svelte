<script lang="ts">
  import { browser } from '$app/environment';
  import * as AiMessage from '$lib/components/ai-elements/message/index.js';
  import * as AiResponse from '$lib/components/ai-elements/response/index.js';
  import { normalizePiMarkdown } from '$lib/adapters/message-adapter';
  import { cn } from '$lib/utils';

  type Renderer = 'message' | 'response';

  interface Props {
    content?: string | null;
    class?: string;
    live?: boolean;
    renderer?: Renderer;
  }

  let { content = '', class: className = '', live = false, renderer = 'message' }: Props = $props();

  const markdownUrlPrefixes = ['*'];
  let defaultOrigin = $derived(browser ? window.location.origin : undefined);
  let safeContent = $derived(normalizePiMarkdown(content || ''));
</script>

{#if renderer === 'response'}
  <AiResponse.Response
    class={cn('phone-markdown', className)}
    content={safeContent}
    parseIncompleteMarkdown={live}
    renderHtml={false}
    defaultOrigin={defaultOrigin}
    allowedLinkPrefixes={markdownUrlPrefixes}
    allowedImagePrefixes={markdownUrlPrefixes}
  />
{:else}
  <AiMessage.MessageResponse
    class={cn('phone-markdown', className)}
    content={safeContent}
    parseIncompleteMarkdown={live}
    renderHtml={false}
    defaultOrigin={defaultOrigin}
    allowedLinkPrefixes={markdownUrlPrefixes}
    allowedImagePrefixes={markdownUrlPrefixes}
  />
{/if}
