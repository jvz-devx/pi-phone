<script lang="ts">
  import * as AiImage from '$lib/components/ai-elements/image/index.js';
  import * as AiMessage from '$lib/components/ai-elements/message/index.js';
  import type { MessageAttachmentData } from '$lib/components/ai-elements/message/index.js';
  import type { RenderableImagePart } from '$lib/adapters/message-adapter';

  interface Props {
    part: RenderableImagePart;
  }

  let { part }: Props = $props();

  const DATA_IMAGE_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

  function dataImagePayload(src: string) {
    const match = src.match(DATA_IMAGE_PATTERN);
    if (!match) return null;
    const base64 = match[2].replace(/\s+/g, '');
    if (!base64) return null;
    return { mediaType: match[1], base64 };
  }

  function imageAttachment(value: RenderableImagePart): MessageAttachmentData {
    return {
      type: 'file',
      filename: value.filename || value.alt,
      mediaType: value.mediaType || 'image/*',
      url: value.src,
    };
  }

  let dataImage = $derived(dataImagePayload(part.src));
</script>

<AiMessage.MessageAttachments class="ml-0 justify-start">
  {#if dataImage}
    <figure class="group relative size-32 overflow-hidden rounded-lg border bg-muted/30 sm:size-40">
      <AiImage.Image
        alt={part.alt}
        base64={dataImage.base64}
        mediaType={dataImage.mediaType}
        class="size-full object-cover object-center transition-transform duration-200 group-hover:scale-[1.03]"
        loading="lazy"
      />
      <figcaption class="sr-only">{part.alt}</figcaption>
    </figure>
  {:else}
    <AiMessage.MessageAttachment data={imageAttachment(part)} class="size-32 sm:size-40" />
  {/if}
</AiMessage.MessageAttachments>
