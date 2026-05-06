<script lang="ts">
	import * as HoverCard from "$lib/components/ui/hover-card/index.js";
	import { ContextClass, setContextValue, type ContextSchema } from "./context-context.svelte";

	interface Props extends ContextSchema {
		children?: import("svelte").Snippet;
		// HoverCard props
		closeDelay?: number;
		openDelay?: number;
		[key: string]: any;
	}

	let {
		usedTokens,
		maxTokens,
		usage,
		modelId,
		children,
		closeDelay = 0,
		openDelay = 0,
		...props
	}: Props = $props();

	const contextInstance = new ContextClass({
		usedTokens,
		maxTokens,
		usage,
		modelId,
	});

	// Update context when props change
	$effect(() => {
		if (contextInstance.usedTokens !== usedTokens) contextInstance.usedTokens = usedTokens;
		if (contextInstance.maxTokens !== maxTokens) contextInstance.maxTokens = maxTokens;
		if (contextInstance.usage !== usage) contextInstance.usage = usage;
		if (contextInstance.modelId !== modelId) contextInstance.modelId = modelId;
	});

	setContextValue(contextInstance);
</script>

<HoverCard.Root {openDelay} {closeDelay} {...props}>
	{@render children?.()}
</HoverCard.Root>
