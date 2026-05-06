import { browser } from '$app/environment';
import type { PhoneThemePayload } from '$lib/types/pi-phone';

const PI_THEME_CSS_VARIABLES = {
  accent: ['--pi-accent', '--primary', '--ring'],
  muted: ['--pi-muted', '--muted-foreground'],
  dim: ['--pi-dim'],
  success: ['--pi-success'],
  warning: ['--pi-warning'],
  danger: ['--pi-danger', '--destructive'],
  text: ['--pi-text', '--foreground', '--card-foreground', '--popover-foreground'],
  mdCode: ['--md-code'],
  mdCodeBlock: ['--md-code-block'],
  mdCodeBlockBorder: ['--md-code-block-border'],
} as const;

const GENERATED_THEME_VARIABLES = ['--primary-foreground'] as const;

type ThemeColorKey = keyof typeof PI_THEME_CSS_VARIABLES;

function trimColor(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidCssColor(value: string) {
  if (!browser || !value) return false;
  return CSS.supports('color', value);
}

function rgbFromHex(value: string) {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return null;
  const normalized = hex.length === 3 ? hex.split('').map((part) => `${part}${part}`).join('') : hex;
  const intValue = Number.parseInt(normalized, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function channelToLinear(value: number) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function foregroundForColor(value: string) {
  const rgb = rgbFromHex(value);
  if (!rgb) return '';
  const luminance = 0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b);
  return luminance > 0.48 ? '#05070a' : '#f8fafc';
}

function removeThemeVariables(root: HTMLElement) {
  for (const variableNames of Object.values(PI_THEME_CSS_VARIABLES)) {
    for (const variableName of variableNames) root.style.removeProperty(variableName);
  }
  for (const variableName of GENERATED_THEME_VARIABLES) root.style.removeProperty(variableName);
}

/**
 * Apply the Pi terminal theme payload to the Svelte/shadcn token surface.
 *
 * The backend intentionally only sends colors that can be represented as CSS-safe
 * values. We keep the neutral dark shell as the default and let Pi's accent and
 * diagnostic colors tint shadcn tokens where that improves recognition.
 */
export function applyPiThemePayload(themePayload: PhoneThemePayload | null | undefined) {
  if (!browser) return;

  const root = document.documentElement;
  const colors = themePayload?.colors || {};
  removeThemeVariables(root);

  for (const [colorKey, variableNames] of Object.entries(PI_THEME_CSS_VARIABLES) as Array<[ThemeColorKey, readonly string[]]>) {
    const value = trimColor(colors[colorKey]);
    if (!isValidCssColor(value)) continue;
    for (const variableName of variableNames) root.style.setProperty(variableName, value);
  }

  const primaryForeground = foregroundForColor(trimColor(colors.accent));
  if (primaryForeground) root.style.setProperty('--primary-foreground', primaryForeground);

  root.classList.add('dark');
  if (themePayload?.name) root.dataset.piTheme = themePayload.name;
  else delete root.dataset.piTheme;
}
