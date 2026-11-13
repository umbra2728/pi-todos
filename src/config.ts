import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TodoConfig } from "./types.ts";

export const DEFAULT_CONFIG: TodoConfig = {
  completedInList: 3,
  completedInOverlay: 3,
  maxOverlayLines: 12,
  settleReminder: true,
};

export interface ConfigResult {
  config: TodoConfig;
  warning?: string;
}

function validNumber(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback;
}

export function loadConfig(path = join(getAgentDir(), "pi-todos.json")): ConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: { ...DEFAULT_CONFIG } };
    return { config: { ...DEFAULT_CONFIG }, warning: `Invalid todo config at ${path}; using defaults` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: { ...DEFAULT_CONFIG }, warning: `Invalid todo config at ${path}; using defaults` };
  }
  const input = raw as Record<string, unknown>;
  const invalid =
    (input.completedInList !== undefined && validNumber(input.completedInList, -1, 100) === -1) ||
    (input.completedInOverlay !== undefined && validNumber(input.completedInOverlay, -1, 100) === -1) ||
    (input.maxOverlayLines !== undefined &&
      (typeof input.maxOverlayLines !== "number" ||
        !Number.isSafeInteger(input.maxOverlayLines) ||
        input.maxOverlayLines < 3 ||
        input.maxOverlayLines > 100)) ||
    (input.settleReminder !== undefined && typeof input.settleReminder !== "boolean");
  return {
    config: {
      completedInList: validNumber(input.completedInList, DEFAULT_CONFIG.completedInList, 100),
      completedInOverlay: validNumber(input.completedInOverlay, DEFAULT_CONFIG.completedInOverlay, 100),
      maxOverlayLines:
        typeof input.maxOverlayLines === "number" &&
        Number.isSafeInteger(input.maxOverlayLines) &&
        input.maxOverlayLines >= 3 &&
        input.maxOverlayLines <= 100
          ? input.maxOverlayLines
          : DEFAULT_CONFIG.maxOverlayLines,
      settleReminder: typeof input.settleReminder === "boolean" ? input.settleReminder : DEFAULT_CONFIG.settleReminder,
    },
    ...(invalid ? { warning: `Invalid todo config values at ${path}; using defaults for invalid fields` } : {}),
  };
}
