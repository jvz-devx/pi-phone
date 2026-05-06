type ThemeLike = {
  name?: string;
  getFgAnsi: (...args: any[]) => string | undefined;
};

const ANSI16_COLORS = [
  "#000000",
  "#800000",
  "#008000",
  "#808000",
  "#000080",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clampColorChannel(value).toString(16).padStart(2, "0")).join("")}`;
}

function xterm256ToHex(index: number) {
  if (index >= 0 && index < ANSI16_COLORS.length) {
    return ANSI16_COLORS[index];
  }

  if (index >= 16 && index <= 231) {
    const cube = [0, 95, 135, 175, 215, 255];
    const value = index - 16;
    const r = cube[Math.floor(value / 36)] ?? 0;
    const g = cube[Math.floor((value % 36) / 6)] ?? 0;
    const b = cube[value % 6] ?? 0;
    return rgbToHex(r, g, b);
  }

  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return rgbToHex(gray, gray, gray);
  }

  return "";
}

function ansiColorToCss(value: string | undefined) {
  if (!value) return "";

  const trueColorMatch = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(value);
  if (trueColorMatch) {
    return rgbToHex(Number(trueColorMatch[1]), Number(trueColorMatch[2]), Number(trueColorMatch[3]));
  }

  const color256Match = /\x1b\[38;5;(\d+)m/.exec(value);
  if (color256Match) {
    return xterm256ToHex(Number(color256Match[1]));
  }

  const sgrForegroundMatch = /\x1b\[(3[0-7]|9[0-7])m/.exec(value);
  if (sgrForegroundMatch) {
    const code = Number(sgrForegroundMatch[1]);
    return ANSI16_COLORS[code >= 90 ? code - 82 : code - 30] || "";
  }

  return "";
}

function themeColorToCss(theme: ThemeLike, colorName: string) {
  try {
    return ansiColorToCss(theme.getFgAnsi(colorName));
  } catch {
    return "";
  }
}

export function buildThemePayload(theme?: ThemeLike | null) {
  if (!theme) return null;

  const colors = {
    accent: themeColorToCss(theme, "accent"),
    muted: themeColorToCss(theme, "muted"),
    dim: themeColorToCss(theme, "dim"),
    success: themeColorToCss(theme, "success"),
    warning: themeColorToCss(theme, "warning"),
    danger: themeColorToCss(theme, "danger"),
    text: themeColorToCss(theme, "text"),
    mdCode: themeColorToCss(theme, "mdCode"),
    mdCodeBlock: themeColorToCss(theme, "mdCodeBlock"),
    mdCodeBlockBorder: themeColorToCss(theme, "mdCodeBlockBorder"),
  };

  if (!Object.values(colors).some(Boolean)) {
    return null;
  }

  return {
    name: theme.name || "",
    colors,
  };
}
