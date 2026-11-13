let nextSessionId = 1;

export function createHost() {
  const sessionId = nextSessionId++;
  const entries: unknown[] = [];
  const handlers = new Map<string, Array<(event: never, ctx: never) => unknown>>();
  const tools = new Map<string, never>();
  const commands = new Map<string, never>();
  const notifications: string[] = [];
  const pi = {
    on(name: string, handler: (event: never, ctx: never) => unknown) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
    registerTool(definition: never) {
      tools.set((definition as { name: string }).name, definition);
    },
    registerCommand(name: string, definition: never) {
      commands.set(name, definition);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data, id: `entry-${entries.length + 1}` });
    },
  };
  const ctx = {
    sessionManager: {
      getSessionId: () => `session-${sessionId}`,
      getBranch: () => entries,
    },
    hasUI: false,
    mode: "print",
    cwd: "/tmp",
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  };
  return {
    pi,
    ctx,
    entries,
    handlers,
    tools,
    commands,
    notifications,
    async emit(name: string, event: unknown) {
      const results = [];
      for (const handler of handlers.get(name) ?? []) results.push(await handler(event as never, ctx as never));
      return results;
    },
  };
}

export type TestHost = ReturnType<typeof createHost>;
