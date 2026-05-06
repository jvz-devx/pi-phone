export const piAiElementPlan = {
  provider: 'pi-phone-internal',
  transport: 'existing-http-and-websocket',
  apiHealthPath: '/api/health',
  websocketPath: '/ws',
  notes: [
    'Do not add the Vercel AI SDK/OpenRouter server route from the guide for Pi Phone.',
    'Use Svelte AI Elements as shadcn-svelte UI components only.',
    'Stream Pi messages from the existing PhoneServerRuntime WebSocket envelopes.',
    'Send prompts through the existing RPC/local-command payloads so Pi extensions, skills, models, and sessions remain available.',
  ],
} as const;

export type PiAiElementPlan = typeof piAiElementPlan;
