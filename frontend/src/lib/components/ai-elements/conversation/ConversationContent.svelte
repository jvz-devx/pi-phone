<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export interface ConversationContentProps extends WithElementRef<
		HTMLAttributes<HTMLDivElement>
	> {
		children?: Snippet;
		autoStick?: boolean;
		initial?: ScrollBehavior | false;
	}
</script>

<script lang="ts">
	import { getStickToBottomContext } from "./stick-to-bottom-context.svelte.js";
	import { watch } from "runed";

	let {
		class: className,
		children,
		autoStick = true,
		initial = "smooth",
		ref = $bindable(null),
		...restProps
	}: ConversationContentProps = $props();

	const context = getStickToBottomContext();

	watch(
		() => ref,
		() => {
			if (autoStick && ref) {
				context.setElement(ref);
				if (initial) context.scrollToBottom(initial);
			}
		}
	);
</script>

<div
	bind:this={ref}
	class={cn("flex-1 overflow-y-auto p-4", className)}
	{...restProps}
>
	{@render children?.()}
</div>
