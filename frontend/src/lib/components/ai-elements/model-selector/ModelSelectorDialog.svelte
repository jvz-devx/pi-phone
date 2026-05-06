<script lang="ts">
	import * as Command from "$lib/components/ui/command/index.js";
	import type { Dialog as DialogPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";

	type Props = {
		open?: boolean;
		ref?: HTMLElement | null;
		value?: string;
		title?: string;
		description?: string;
		portalProps?: DialogPrimitive.PortalProps;
		children: Snippet;
		[key: string]: unknown;
	};

	let {
		open = $bindable(false),
		ref = $bindable(null),
		value = $bindable(""),
		title = "Model Selector",
		description = "Search for a model",
		portalProps,
		children,
		...restProps
	}: Props = $props();
</script>

<Command.Dialog bind:open bind:ref bind:value {title} {description} {portalProps} {...restProps}>
	{@render children()}
</Command.Dialog>
