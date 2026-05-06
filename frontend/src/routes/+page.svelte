<script lang="ts">
  import { onMount } from 'svelte';
  import AppShell from '$lib/components/app/AppShell.svelte';
  import LoginDialog from '$lib/components/app/LoginDialog.svelte';
  import ToastHost from '$lib/components/feedback/ToastHost.svelte';
  import { consumeLoginTokenFromCurrentUrl } from '$lib/actions/auth';
  import { transformPhoneMessages } from '$lib/adapters/message-adapter';
  import {
    applyClientNotice,
    registerPhoneClientStoreHandlers,
  } from '$lib/actions/envelope-handlers';
  import { phoneClient, readStoredToken, type PhoneHealth } from '$lib/pi-phone-transport';
  import { piPhoneState } from '$lib/stores/pi-phone-state';
  import type { PhoneRawMessage, PhoneStatus, PhoneUiToolMessage } from '$lib/types/pi-phone';

  let appState = $derived($piPhoneState);
  let fixtureMode = $state(false);
  let booted = $state(false);

  const fixtureMessages = [
    {
      role: 'user',
      timestamp: 1700000000000,
      content: [
        { type: 'text', text: 'Can you inspect this tiny image and then run `pwd`?' },
        {
          type: 'image',
          mimeType: 'image/gif',
          data: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          name: 'pixel.gif',
        },
      ],
    },
    {
      role: 'assistant',
      timestamp: 1700000001000,
      model: 'gpt-5-codex',
      content: [
        { type: 'thinking', thinking: 'Need to acknowledge the image and call bash.' },
        { type: 'text', text: 'I can do that. Running `pwd` now.' },
        { type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } },
      ],
      usage: { input: 12, output: 8 },
      stopReason: 'tool_use',
    },
    {
      role: 'toolResult',
      timestamp: 1700000002000,
      toolCallId: 'tool-1',
      toolName: 'bash',
      content: '/home/jens/Documents/source/pi-phone',
    },
    {
      role: 'custom',
      timestamp: 1700000003000,
      customType: 'phone-inline-user-message',
      content: 'Inline user message from an extension.',
    },
    { role: 'branchSummary', timestamp: 1700000004000, summary: 'This branch explored chat rendering parity.' },
    { role: 'compactionSummary', timestamp: 1700000005000, summary: 'Older context was compacted.', tokensBefore: 12345 },
  ] satisfies PhoneRawMessage[];

  function seedFixtureState() {
    fixtureMode = true;
    piPhoneState.reset({ token: '' });

    const health: PhoneHealth = {
      cwd: '/home/jens/Documents/source/pi-phone',
      hasToken: false,
      isRunning: true,
      childRunning: true,
      isStreaming: true,
      isCompacting: false,
      host: 'fixture',
      port: 0,
      connectedClients: 1,
      sessionCount: 1,
      controlOwner: 'phone',
      commandContextAvailable: true,
      theme: {
        name: 'fixture-neutral-pi',
        colors: {
          accent: '#8bd3ff',
          muted: '#a3adba',
          dim: '#7b8492',
          success: '#91e7b6',
          warning: '#f8d06b',
          danger: '#ff8f8f',
          mdCode: '#8bd3ff',
          mdCodeBlock: '#eef4fb',
          mdCodeBlockBorder: '#3b4652',
        },
      },
    };

    const status: PhoneStatus = {
      ...health,
      cwd: health.cwd || '',
      childRunning: true,
      isStreaming: true,
      isCompacting: false,
      lastError: '',
      childPid: null,
      sessionWorkerId: 'fixture-parent',
      sessionKind: 'parent',
      activeSessionId: 'fixture-parent',
    };

    piPhoneState.setHealth(health);
    piPhoneState.setStatus(status);
    piPhoneState.setActiveSessions(
      [
        {
          id: 'fixture-parent',
          kind: 'parent',
          sessionId: 'fixture-session',
          sessionFile: null,
          sessionName: 'Fixture session',
          label: 'Fixture parent',
          secondaryLabel: 'Local adapter preview',
          firstUserPreview: 'Can you inspect this tiny image?',
          lastUserPreview: 'Can you inspect this tiny image?',
          model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT-5 Codex' },
          isRunning: true,
          isStreaming: true,
          isCompacting: false,
          messageCount: fixtureMessages.length,
          pendingMessageCount: 0,
          hasPendingUiRequest: false,
          lastError: '',
          lastActivityAt: Date.now(),
          childPid: null,
          cwd: health.cwd,
          mirrorsCli: true,
          commandContextAvailable: true,
        },
        {
          id: 'fixture-parallel',
          kind: 'parallel',
          sessionId: 'fixture-parallel-session',
          sessionFile: null,
          sessionName: 'Fixture parallel',
          label: 'Parallel · UI request',
          secondaryLabel: 'Needs extension input',
          firstUserPreview: 'Explore the saved sessions sheet.',
          lastUserPreview: 'Awaiting a confirmation request.',
          model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT-5 Codex' },
          isRunning: true,
          isStreaming: false,
          isCompacting: false,
          messageCount: 7,
          pendingMessageCount: 1,
          hasPendingUiRequest: true,
          lastError: '',
          lastActivityAt: Date.now() - 90_000,
          childPid: null,
          cwd: '/home/jens/Documents/source/pi-phone/frontend',
          mirrorsCli: false,
          commandContextAvailable: true,
        },
      ],
      'fixture-parent',
    );
    piPhoneState.setSnapshot(
      {
        model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT-5 Codex', contextWindow: 272000 },
        thinkingLevel: 'medium',
        isStreaming: true,
        isCompacting: false,
        sessionFile: null,
        sessionId: 'fixture-session',
        sessionName: 'Fixture session',
        messageCount: fixtureMessages.length,
        pendingMessageCount: 0,
        commandContextAvailable: true,
        contextUsage: { tokens: 4096, contextWindow: 272000, percent: 1.5 },
      },
      'fixture-parent',
    );
    piPhoneState.setQuota({
      visible: true,
      limited: false,
      primaryWindow: { label: '5h', leftPercent: 84, usedPercent: 16, resetAfterSeconds: 7200, text: '84%' },
      secondaryWindow: { label: '7d', leftPercent: 61, usedPercent: 39, resetAfterSeconds: 345600, text: '61%' },
    });
    piPhoneState.setStats({
      sessionFile: null,
      sessionId: 'fixture-session',
      userMessages: 4,
      assistantMessages: 5,
      toolCalls: 3,
      toolResults: 3,
      totalMessages: 12,
      tokens: { input: 5123, output: 1204, cacheRead: 2000, cacheWrite: 300, total: 8627 },
      cost: 0.0123,
    });
    piPhoneState.setMessages(transformPhoneMessages(fixtureMessages));
    piPhoneState.setLiveTools(
      new Map<string, PhoneUiToolMessage>([
        [
          'tool-live-check',
          {
            id: 'tool-live-check',
            kind: 'tool',
            title: 'bash · running',
            meta: 'Streaming…',
            text: 'npm run frontend:check\n',
            live: true,
            toolCallId: 'tool-live-check',
            toolName: 'bash',
            command: 'npm run frontend:check',
            status: 'running',
          },
        ],
      ]),
    );
    piPhoneState.setSelectedToolId('tool-live-check');
    piPhoneState.setLiveAssistant({
      id: 'assistant-live-fixture',
      kind: 'assistant',
      live: true,
      meta: 'Streaming…',
      thinking: 'Following the latest content while the scroll container grows.',
      text: 'This live fixture exercises the near-bottom threshold, stream following, and jump-to-latest button inside the production AppShell.',
      toolCalls: [],
    });
    piPhoneState.setConnectionState('open');
  }

  function openLogin() {
    piPhoneState.clearAuthError();
    piPhoneState.setLoginOpen(true);
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fixture') === '1' || params.get('fixture') === 'true') {
      seedFixtureState();
      booted = true;
      return;
    }

    consumeLoginTokenFromCurrentUrl();
    const storedToken = readStoredToken();
    piPhoneState.reset({ token: storedToken });
    phoneClient.setToken(storedToken, { store: false });
    const unregister = registerPhoneClientStoreHandlers();
    booted = true;
    void phoneClient.boot().catch((error) => {
      applyClientNotice('banner', {
        message: error instanceof Error ? error.message : 'Failed to start Pi Phone client.',
        level: 'error',
      });
    });

    return () => {
      unregister();
      phoneClient.close({ manual: true, reason: 'svelte-page-destroy' });
    };
  });
</script>

<svelte:head>
  <title>{appState.uiRequests.title || 'Pi Phone'}</title>
</svelte:head>

<AppShell fixtureMode={fixtureMode} onOpenLogin={openLogin} />
<LoginDialog {booted} />
<ToastHost />
