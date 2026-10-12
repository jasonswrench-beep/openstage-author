// The themes that come with the editor. Each is a plain file in the themes folder of the
// repository. A project gets its own copy in theme.json, so it keeps its look even if this list
// changes, and the author can still edit that copy.

import berry from "../../themes/berry.theme.json" with { type: "json" };
import classic from "../../themes/classic.theme.json" with { type: "json" };
import forest from "../../themes/forest.theme.json" with { type: "json" };
import highContrast from "../../themes/high-contrast.theme.json" with { type: "json" };
import midnight from "../../themes/midnight.theme.json" with { type: "json" };
import ocean from "../../themes/ocean.theme.json" with { type: "json" };
import slate from "../../themes/slate.theme.json" with { type: "json" };
import sunset from "../../themes/sunset.theme.json" with { type: "json" };
import type { Theme } from "../../player/src/types.ts";

export const BUILT_IN_THEMES: Theme[] = [classic, slate, midnight, forest, sunset, ocean, highContrast, berry] as Theme[];

export const DEFAULT_THEME: Theme = classic as Theme;

export const cloneTheme = (t: Theme): Theme => JSON.parse(JSON.stringify(t)) as Theme;

/** Friendly names for the theme colours, for the colour chooser. */
export const COLOR_ROLE_NAMES: Record<string, string> = {
  background: "Background", surface: "Surface", text: "Text", muted: "Quiet text", accent: "Accent",
  accentStrong: "Strong accent", onAccentStrong: "Text on strong accent", dark: "Dark", onDark: "Text on dark",
  good: "Positive", bad: "Negative", line: "Line",
};
