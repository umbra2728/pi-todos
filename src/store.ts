import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { replayOperations } from "./replay.ts";
import type { ReplayResult } from "./replay.ts";
import type { TodoState } from "./types.ts";

const states = new Map<string, TodoState>();

export function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId() ?? "";
}

export function restoreSession(ctx: ExtensionContext): ReplayResult {
  const restored = replayOperations(ctx.sessionManager.getBranch());
  states.set(sessionKey(ctx), restored.state);
  return restored;
}

export function getSessionState(ctx: ExtensionContext): TodoState {
  const key = sessionKey(ctx);
  const existing = states.get(key);
  if (existing) return existing;
  return restoreSession(ctx).state;
}

export function commitSessionState(ctx: ExtensionContext, state: TodoState): void {
  states.set(sessionKey(ctx), state);
}

export function evictSession(ctx: ExtensionContext): void {
  states.delete(sessionKey(ctx));
}
