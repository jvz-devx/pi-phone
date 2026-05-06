<script lang="ts">
	import { Collapsible } from "$lib/components/ui/collapsible/index.js";
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";

	interface ToolProps {
		class?: string;
		children?: Snippet;
		open?: boolean;
		[key: string]: any;
	}

	let { class: className = "", children, open = $bindable(false), ...restProps }: ToolProps = $props();

	let id = $derived.by(() => crypto.randomUUID());
</script>

<Collapsible {id} bind:open class={cn("not-prose mb-4 w-full rounded-md border", className)} {...restProps}>
	{@render children?.()}
</Collapsible>
