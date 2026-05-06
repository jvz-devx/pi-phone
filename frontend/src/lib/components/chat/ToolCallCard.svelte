<script lang="ts">
  import * as AiArtifact from '$lib/components/ai-elements/artifact/index.js';
  import * as AiCode from '$lib/components/ai-elements/code/index.js';
  import * as AiTool from '$lib/components/ai-elements/tool/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import PiMarkdown from '$lib/components/chat/PiMarkdown.svelte';
  import MessageDisclosure from '$lib/components/chat/MessageDisclosure.svelte';
  import { buildToolPreview, type ToolListEntry, type ToolPreviewBadgeVariant, type ToolPreviewSection } from '$lib/adapters/tool-adapter';
  import { piPhoneState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
  import type { PhoneUiToolMessage, UnknownRecord } from '$lib/types/pi-phone';
  import { cn } from '$lib/utils';

  interface Props {
    item: PhoneUiToolMessage;
    stateStore?: PhoneStateStore;
    class?: string;
  }

  let { item, stateStore = piPhoneState, class: className = '' }: Props = $props();

  let preview = $derived(buildToolPreview(item));
  let open = $state(initialOpenValue());

  function initialOpenValue() {
    return stateStore.snapshot().tools.panelOpen.get(item.id) ?? buildToolPreview(item).defaultOpen;
  }

  function getOpen() {
    return open;
  }

  function setOpen(nextOpen: boolean) {
    if (open === nextOpen) return;
    open = nextOpen;
    stateStore.setToolPanelOpen(item.id, nextOpen);
  }

  function badgeClass(variant: ToolPreviewBadgeVariant = 'neutral') {
    return cn(
      'border bg-background/65 font-mono text-[0.7rem] text-muted-foreground',
      variant === 'accent' && 'border-primary/25 bg-primary/10 text-primary',
      variant === 'added' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
      variant === 'removed' && 'border-rose-500/25 bg-rose-500/10 text-rose-300',
      variant === 'warning' && 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    );
  }

  function diffLineClass(kind: string) {
    return cn(
      'grid grid-cols-[4.25rem_minmax(0,1fr)] border-b border-border/30 text-xs leading-5 last:border-b-0',
      kind === 'added' && 'bg-emerald-500/10 text-emerald-50',
      kind === 'removed' && 'bg-rose-500/10 text-rose-50',
      kind === 'meta' && 'bg-muted/40 text-muted-foreground',
    );
  }

  function matchLineClass(kind: string) {
    return cn(
      'grid grid-cols-[3.25rem_minmax(0,1fr)] border-b border-border/30 text-xs leading-5 last:border-b-0',
      kind === 'match' ? 'bg-primary/10 text-foreground' : 'bg-muted/20 text-muted-foreground',
    );
  }

  function listEntryText(entry: string | ToolListEntry) {
    return typeof entry === 'string' ? entry : entry.text;
  }

  function listEntryKind(entry: string | ToolListEntry) {
    return typeof entry === 'string' ? (entry.endsWith('/') ? 'directory' : 'file') : entry.kind;
  }

  function listEntryClass(entry: string | ToolListEntry) {
    return cn(
      'grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-border/45 bg-background/45 px-3 py-2 text-xs',
      listEntryKind(entry) === 'directory' && 'border-primary/20 bg-primary/5',
    );
  }

  function sectionKey(section: ToolPreviewSection, index: number) {
    if (section.type === 'image') return `${index}:image:${section.src.slice(0, 24)}`;
    if (section.type === 'grep') return `${index}:grep:${section.matchCount}:${section.fileCount}`;
    if (section.type === 'list') return `${index}:list:${section.entries.length}`;
    if (section.type === 'diff') return `${index}:diff:${section.lines.length}`;
    return `${index}:${section.type}`;
  }

  function toolDetailsForSecondarySection(message: PhoneUiToolMessage) {
    if (!message.details) return null;
    const name = String(message.toolName || message.title || '').trim().split(' · ')[0].toLowerCase();
    if (name !== 'edit') return message.details;
    if (!message.details || typeof message.details !== 'object' || Array.isArray(message.details)) return message.details;
    const { diff: _diff, firstChangedLine: _firstChangedLine, ...rest } = message.details as UnknownRecord;
    return Object.keys(rest).length ? rest : null;
  }

  function selectTool() {
    stateStore.setSelectedToolId(item.id);
  }

  let toolPanelLabel = $derived(`${preview.toolName} tool call, ${preview.statusLabel}`);
</script>

<AiTool.Tool
  bind:open={getOpen, setOpen}
  class={cn('phone-tool-card mb-0 overflow-hidden border-border/65 bg-card/85 shadow-sm', className)}
  data-tool-id={item.id}
  data-tool-status={preview.status}
  role="region"
  aria-label={toolPanelLabel}
>
  <AiTool.ToolHeader
    type={preview.toolName}
    state={preview.state}
    statusLabel={preview.statusLabel}
    class="bg-muted/20 hover:bg-muted/35"
    onclick={selectTool}
    aria-label={`${open ? 'Collapse' : 'Expand'} ${toolPanelLabel}`}
    title={`${open ? 'Collapse' : 'Expand'} ${preview.toolName} details`}
  />
  <AiTool.ToolContent>
    {#if preview.input}
      <AiTool.ToolInput input={preview.input} class="border-t border-border/50" />
    {/if}

    {#if preview.errorText && !preview.sections.length}
      <AiTool.ToolOutput errorText={preview.errorText} />
    {/if}

    {#if preview.artifact}
      <div class="border-t border-border/50 p-3 sm:p-4">
        <AiArtifact.Root class="border-border/60 bg-background/55 shadow-none">
          <AiArtifact.Header class="gap-3 bg-muted/25">
            <div class="min-w-0 space-y-1">
              <AiArtifact.Title>{preview.eyebrow}</AiArtifact.Title>
              <AiArtifact.Description class="break-all font-mono text-xs">{preview.subject}</AiArtifact.Description>
            </div>
            {#if preview.badges.length}
              <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                {#each preview.badges as badge}
                  <Badge variant="outline" class={badgeClass(badge.variant)}>{badge.label}</Badge>
                {/each}
              </div>
            {/if}
          </AiArtifact.Header>
          <AiArtifact.Content class="space-y-3 p-3 sm:p-4">
            {#if preview.note}
              <p class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{preview.note}</p>
            {/if}
            {#each preview.sections as section, index (sectionKey(section, index))}
              {#if section.type === 'code'}
                <div class="space-y-2">
                  {#if section.startLine && section.startLine > 1}
                    <div class="text-xs text-muted-foreground">Preview starts at line {section.startLine}</div>
                  {/if}
                  <AiCode.Root code={section.code} lang={section.lang} hideLines={false} class="max-h-[34rem]" />
                  {#if section.hiddenCount}
                    <div class="text-xs text-muted-foreground">… {section.hiddenCount} more line{section.hiddenCount === 1 ? '' : 's'}</div>
                  {/if}
                  {#if section.notice}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
                  {/if}
                </div>
              {:else if section.type === 'markdown'}
                <div class="space-y-2">
                  <div class="rounded-md border border-border/50 bg-card/60 p-3">
                    <PiMarkdown content={section.markdown} />
                  </div>
                  {#if section.hiddenCount}
                    <div class="text-xs text-muted-foreground">… {section.hiddenCount} more markdown line{section.hiddenCount === 1 ? '' : 's'}</div>
                  {/if}
                  {#if section.notice}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
                  {/if}
                </div>
              {:else if section.type === 'image'}
                <div class="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
                  <img class="max-h-[70vh] w-full object-contain" src={section.src} alt={section.alt} loading="lazy" />
                </div>
              {:else if section.type === 'diff'}
                <div class="overflow-hidden rounded-lg border border-border/60 bg-background/70 font-mono">
                  {#if section.lines.length}
                    {#each section.lines as line}
                      <div class={diffLineClass(line.kind)}>
                        <span class="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">
                          {(line.prefix || (line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ')) + (line.lineNumber || '')}
                        </span>
                        <span class="overflow-x-auto whitespace-pre px-3 py-0.5">{line.text === '' ? ' ' : line.text}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="p-3 text-xs text-muted-foreground">No diff preview available.</div>
                  {/if}
                </div>
                {#if section.hiddenCount}
                  <div class="text-xs text-muted-foreground">… {section.hiddenCount} more diff lines</div>
                {/if}
              {:else if section.type === 'terminal'}
                <div class="space-y-2">
                  <AiCode.Root code={section.code} lang={section.lang} hideLines class="max-h-[34rem]" />
                  {#if section.hiddenCount}
                    <div class="text-xs text-muted-foreground">… {section.hiddenCount} more output line{section.hiddenCount === 1 ? '' : 's'}</div>
                  {/if}
                  {#if section.notice}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
                  {/if}
                </div>
              {:else if section.type === 'grep'}
                <div class="space-y-3">
                  {#if section.groups.length}
                    {#each section.groups as group}
                      <section class="overflow-hidden rounded-lg border border-border/60 bg-background/60">
                        <div class="border-b border-border/50 bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">{group.path}</div>
                        <div class="font-mono">
                          {#each group.entries as entry}
                            <div class={matchLineClass(entry.kind)}>
                              <span class="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">{entry.lineNumber}</span>
                              <span class="overflow-x-auto whitespace-pre px-3 py-0.5">{entry.text === '' ? ' ' : entry.text}</span>
                            </div>
                          {/each}
                        </div>
                        {#if group.hiddenCount}
                          <div class="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">… {group.hiddenCount} more line{group.hiddenCount === 1 ? '' : 's'} in {group.path}</div>
                        {/if}
                      </section>
                    {/each}
                    {#if section.hiddenFileCount}
                      <div class="text-xs text-muted-foreground">… {section.hiddenFileCount} more matching file{section.hiddenFileCount === 1 ? '' : 's'}</div>
                    {/if}
                  {:else}
                    <AiCode.Root code={section.fallback || 'No matches.'} lang="text" hideLines />
                  {/if}
                  {#if section.notice}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
                  {/if}
                </div>
              {:else if section.type === 'list'}
                <div class="space-y-2">
                  {#if section.entries.length}
                    <div class="grid gap-2">
                      {#each section.entries as entry}
                        <div class={listEntryClass(entry)}>
                          <span class="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 text-center text-[0.65rem] uppercase text-muted-foreground">
                            {listEntryKind(entry) === 'directory' ? 'dir' : 'file'}
                          </span>
                          <span class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs" title={listEntryText(entry)}>{listEntryText(entry)}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.emptyLabel || 'No results.'}</div>
                  {/if}
                  {#if section.hiddenCount}
                    <div class="text-xs text-muted-foreground">… {section.hiddenCount} more result{section.hiddenCount === 1 ? '' : 's'}</div>
                  {/if}
                  {#if section.notice}
                    <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
                  {/if}
                </div>
              {:else if section.type === 'text'}
                <div class="whitespace-pre-wrap rounded-md border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">{section.text}</div>
              {/if}
            {/each}
          </AiArtifact.Content>
        </AiArtifact.Root>
      </div>
    {:else if preview.sections.length}
      <div class="space-y-3 border-t border-border/50 p-3 sm:p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{preview.eyebrow}</div>
            <div class="break-all font-mono text-sm text-foreground">{preview.subject}</div>
          </div>
          {#if preview.badges.length}
            <div class="flex flex-wrap justify-end gap-1.5">
              {#each preview.badges as badge}
                <Badge variant="outline" class={badgeClass(badge.variant)}>{badge.label}</Badge>
              {/each}
            </div>
          {/if}
        </div>
        {#if preview.note}
          <p class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{preview.note}</p>
        {/if}
        {#each preview.sections as section, index (sectionKey(section, index))}
          {#if section.type === 'terminal'}
            <AiCode.Root code={section.code} lang={section.lang} hideLines class="max-h-[34rem]" />
            {#if section.hiddenCount}
              <div class="text-xs text-muted-foreground">… {section.hiddenCount} more output line{section.hiddenCount === 1 ? '' : 's'}</div>
            {/if}
            {#if section.notice}
              <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
            {/if}
          {:else if section.type === 'text'}
            <div class="whitespace-pre-wrap rounded-md border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">{section.text}</div>
          {:else if section.type === 'grep'}
            <div class="space-y-3">
              {#if section.groups.length}
                {#each section.groups as group}
                  <section class="overflow-hidden rounded-lg border border-border/60 bg-background/60">
                    <div class="border-b border-border/50 bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">{group.path}</div>
                    <div class="font-mono">
                      {#each group.entries as entry}
                        <div class={matchLineClass(entry.kind)}>
                          <span class="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">{entry.lineNumber}</span>
                          <span class="overflow-x-auto whitespace-pre px-3 py-0.5">{entry.text === '' ? ' ' : entry.text}</span>
                        </div>
                      {/each}
                    </div>
                    {#if group.hiddenCount}
                      <div class="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">… {group.hiddenCount} more line{group.hiddenCount === 1 ? '' : 's'} in {group.path}</div>
                    {/if}
                  </section>
                {/each}
                {#if section.hiddenFileCount}
                  <div class="text-xs text-muted-foreground">… {section.hiddenFileCount} more matching file{section.hiddenFileCount === 1 ? '' : 's'}</div>
                {/if}
              {:else}
                <AiCode.Root code={section.fallback || 'No matches.'} lang="text" hideLines />
              {/if}
              {#if section.notice}
                <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
              {/if}
            </div>
          {:else if section.type === 'list'}
            <div class="space-y-2">
              {#if section.entries.length}
                <div class="grid gap-2">
                  {#each section.entries as entry}
                    <div class={listEntryClass(entry)}>
                      <span class="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 text-center text-[0.65rem] uppercase text-muted-foreground">{listEntryKind(entry) === 'directory' ? 'dir' : 'file'}</span>
                      <span class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs" title={listEntryText(entry)}>{listEntryText(entry)}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.emptyLabel || 'No results.'}</div>
              {/if}
              {#if section.hiddenCount}
                <div class="text-xs text-muted-foreground">… {section.hiddenCount} more result{section.hiddenCount === 1 ? '' : 's'}</div>
              {/if}
              {#if section.notice}
                <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
              {/if}
            </div>
          {:else if section.type === 'code'}
            <div class="space-y-2">
              {#if section.startLine && section.startLine > 1}
                <div class="text-xs text-muted-foreground">Preview starts at line {section.startLine}</div>
              {/if}
              <AiCode.Root code={section.code} lang={section.lang} hideLines={false} class="max-h-[34rem]" />
              {#if section.hiddenCount}
                <div class="text-xs text-muted-foreground">… {section.hiddenCount} more line{section.hiddenCount === 1 ? '' : 's'}</div>
              {/if}
              {#if section.notice}
                <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
              {/if}
            </div>
          {:else if section.type === 'markdown'}
            <div class="space-y-2">
              <div class="rounded-md border border-border/50 bg-card/60 p-3"><PiMarkdown content={section.markdown} /></div>
              {#if section.hiddenCount}
                <div class="text-xs text-muted-foreground">… {section.hiddenCount} more markdown line{section.hiddenCount === 1 ? '' : 's'}</div>
              {/if}
              {#if section.notice}
                <div class="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{section.notice}</div>
              {/if}
            </div>
          {:else if section.type === 'image'}
            <div class="overflow-hidden rounded-lg border border-border/60 bg-muted/20"><img class="max-h-[70vh] w-full object-contain" src={section.src} alt={section.alt} loading="lazy" /></div>
          {:else if section.type === 'diff'}
            <div class="overflow-hidden rounded-lg border border-border/60 bg-background/70 font-mono">
              {#if section.lines.length}
                {#each section.lines as line}
                  <div class={diffLineClass(line.kind)}>
                    <span class="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">{(line.prefix || ' ') + (line.lineNumber || '')}</span>
                    <span class="overflow-x-auto whitespace-pre px-3 py-0.5">{line.text === '' ? ' ' : line.text}</span>
                  </div>
                {/each}
              {:else}
                <div class="p-3 text-xs text-muted-foreground">No diff preview available.</div>
              {/if}
            </div>
            {#if section.hiddenCount}
              <div class="text-xs text-muted-foreground">… {section.hiddenCount} more diff lines</div>
            {/if}
          {/if}
        {/each}
      </div>
    {/if}

    {#if toolDetailsForSecondarySection(item)}
      <MessageDisclosure class="mx-4 mb-4" title="Details" value={toolDetailsForSecondarySection(item)} />
    {/if}
  </AiTool.ToolContent>
</AiTool.Tool>
