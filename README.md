# pi-todos

Incremental, session-native todo tracking for [Pi](https://pi.dev). One `todo` tool, small lifecycle actions, no full-list rewrites, and no task files.

## Why

Most todo extensions either replace the complete list on every update or expose a broad `update` call where models can forget the actual mutation. `pi-todos` uses dedicated lifecycle actions instead:

```json
{ "action": "start", "id": 3 }
{ "action": "complete", "id": 3 }
{ "action": "reopen", "id": 3 }
```

Status changes need only an ID. Evidence and activity labels are optional. Updates never require the model to resend existing tasks.

## Features

- One `todo` tool with sequential, ID-based mutations.
- `pending`, `in_progress`, `completed`, and hidden `deleted` tombstones.
- Multiple active tasks with optional owners.
- Atomic initial batch creation without replacing existing tasks.
- Dependency validation with unresolved-start protection and cycle detection.
- Optional completion evidence.
- Session-branch operation journal instead of repeated full snapshots.
- Reload, branch, resume, and compaction recovery with per-session isolation.
- Live overlay with open tasks and three recent completed tasks.
- Read-only `/todos` filters.
- One balanced reconciliation reminder per user prompt when work remains open.
- Strict schemas and safe repair of legacy `update + status` calls.
- Structured results for codemode.

## Install

Remove any extension that already owns the `todo` tool, then install `pi-todos`:

```bash
pi remove npm:@juicesharp/rpiv-todo
pi install npm:pi-todos
```

For local development:

```bash
pi -e /path/to/pi-todos
```

Existing tasks from other todo extensions are not migrated.

## Tool actions

### Create

One task:

```json
{
  "action": "create",
  "subject": "Inspect the implementation",
  "description": "Read the reducer and replay logic",
  "owner": "researcher"
}
```

An initial batch:

```json
{
  "action": "create",
  "tasks": [
    { "subject": "Inspect the implementation" },
    { "subject": "Implement incremental updates" },
    { "subject": "Verify the behavior" }
  ]
}
```

Batch creation is atomic and appends tasks. It never replaces the current list. Batch items may depend on existing tasks or earlier items in the same batch; forward and self references are rejected.

### Start, complete, and reopen

```json
{ "action": "start", "id": 1, "activeForm": "inspecting the implementation" }
{ "action": "complete", "id": 1, "evidence": "npm test: 42 passed" }
{ "action": "reopen", "id": 1 }
```

`activeForm` and `evidence` are optional. Transitions are tolerant and exact retries return `No change`. Starting a task with unresolved dependencies returns an error.

### Update fields

```json
{
  "action": "update",
  "id": 2,
  "description": "Updated acceptance criteria",
  "addBlockedBy": [1]
}
```

Mutable fields are `subject`, `description`, `activeForm`, `owner`, `evidence`, `addBlockedBy`, and `removeBlockedBy`. Pass `null` to clear an optional text field. Status is changed only through lifecycle actions.

### List and inspect

```json
{ "action": "list" }
{ "action": "list", "status": "completed", "completedLimit": 10 }
{ "action": "list", "status": "all" }
{ "action": "get", "id": 2 }
```

The default list contains open tasks and the three most recently completed tasks. Deleted tasks appear only when requested with `status: "deleted"` or `status: "all"`.

### Delete and clear

```json
{ "action": "delete", "id": 2 }
{ "action": "clear_completed" }
{ "action": "clear_all" }
```

`delete` creates a tombstone. `clear_completed` physically prunes completed tasks and their dependency edges without resetting IDs. `clear_all` removes all tasks and resets IDs.

## Overlay and command

The overlay shows open tasks and three recent completed tasks within a bounded row budget.

`/todos` is read-only:

```text
/todos
/todos open
/todos pending
/todos in_progress
/todos completed 20
/todos deleted
/todos all
```

With no arguments, `/todos` shows all non-deleted tasks grouped by status.

## Reminders

After session restoration or compaction, the next model request receives one compact list of open tasks.

If the agent tries to finish with open tasks, the extension requests one reconciliation continuation per genuine user prompt. The reminder explicitly allows intentional pauses for user questions, waiting for input, or background work; otherwise, the agent should continue and finish the remaining work. There is no repeated autonomous loop.

## Configuration

No configuration is required. Optional JSON lives at `~/.pi/agent/pi-todos.json`:

```json
{
  "completedInList": 3,
  "completedInOverlay": 3,
  "maxOverlayLines": 12,
  "settleReminder": true
}
```

Changes are read when needed. Invalid values fall back to defaults with a warning.

## Development

Requires Node `>=22.19.0`.

```bash
npm ci
npm run check
```

The check suite runs TypeScript, `node:test`, no-comment validation, and `npm pack --dry-run`. TypeScript ships directly; there is no build step.

See [CONCEPT.md](./CONCEPT.md) for the complete design and acceptance criteria.

## Releasing

Releases use GitHub Actions and npm Trusted Publishing with provenance:

```bash
npm version patch
git push --follow-tags
```

The tag must match `package.json`. The workflow runs all checks, publishes to npm, and creates a GitHub Release.

## License

MIT
