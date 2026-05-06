import type { PhoneSheetMode } from '$lib/types/pi-phone';

export type PhoneMobilePanel = 'inspector' | 'actions' | PhoneSheetMode | null;

export type VisualViewportMetrics = {
  height?: number | null;
  offsetTop?: number | null;
};

export type ViewportCssVars = {
  visualHeight: number;
  keyboardInset: number;
};

export type DesktopPanelTransition = {
  mobilePanel: null;
  leftOpen?: boolean;
  rightOpen?: boolean;
};

export function computeViewportCssVars(innerHeight: number, viewport?: VisualViewportMetrics | null): ViewportCssVars {
  const safeInnerHeight = Math.max(0, Math.round(Number.isFinite(innerHeight) ? innerHeight : 0));
  const visualHeight = viewport?.height == null ? safeInnerHeight : Math.max(0, Math.round(viewport.height));
  const offsetTop = viewport?.offsetTop == null ? 0 : Math.max(0, viewport.offsetTop);
  const keyboardInset = viewport ? Math.max(0, Math.round(safeInnerHeight - visualHeight - offsetTop)) : 0;

  return { visualHeight, keyboardInset };
}

export function shouldShowJumpToLatest(hasRenderableContent: boolean, followLatest: boolean, nearBottom: boolean) {
  return Boolean(hasRenderableContent && !followLatest && !nearBottom);
}

export function reconcileMobilePanelForDesktop(panel: PhoneMobilePanel, sheetsOpen = false): DesktopPanelTransition | null {
  if (!panel && !sheetsOpen) return null;
  if (panel === 'active-sessions') return { mobilePanel: null, leftOpen: true };
  if (panel === 'inspector' || panel === 'actions' || sheetsOpen) return { mobilePanel: null, rightOpen: true };
  return { mobilePanel: null, rightOpen: true };
}
