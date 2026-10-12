// Colour arithmetic and theme references that do not belong to any one screen.

import { colorRef as ref, COLOR_ROLES, type ColorRole } from "../../player/src/theme.ts";
import { contrastRatio } from "./content.ts";

export const colorRef = (role: string): string => ref(role as ColorRole);
export { COLOR_ROLES };

/** WCAG contrast between two hex colours. */
export const contrastOf = (a: string, b: string): number => contrastRatio(a, b);
