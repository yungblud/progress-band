---
name: progress-band
description: Keep the progress-band files up to date while you coordinate subagents, so the person sees a live progress bar above the prompt. Use when you run multi-step work with background subagents, or when the person asks to see progress as a bar.
---

# progress-band

The `progress-band` plugin draws a bar above the prompt from files in this session's own folder, `.claude/progress/<session id>/` under the session's project root, the directory the session started in. A shell `cd` does not move that folder. Find it with Bash from the project root: `echo "$PWD/.claude/progress/$CLAUDE_CODE_SESSION_ID"`. If your shell has moved, `cd` back to the project root first. Plugins cannot add this to your context where an organization's security plugin runs first, so do not wait for a line that names it. Write every file there, never in `.claude/progress/` itself, because other sessions in the same repo share that parent. The plugin reads the folder every 5 seconds. With no `program.json` it draws nothing.

## Files

One writer per file, so no two agents ever write the same file.

`<session folder>/program.json`. Only the coordinator writes this file.

```json
{
  "title": "API migration",
  "locale": "en",
  "staleMinutes": 15,
  "items": [
    { "id": "auth", "label": "Auth", "weight": 12, "state": "done" },
    { "id": "billing", "label": "Billing", "weight": 9, "state": "active", "agent": "billing-agent" },
    { "id": "cleanup", "label": "Cleanup", "weight": 15, "state": "waiting" }
  ]
}
```

- `state` is one of `done`, `review` (a PR waits for merge), `active`, or `waiting`.
- `weight` is the item's share of the whole job, for example its screen or file count. It defaults to 1.
- `agent` names the item's progress file, `<agent>.json`.
- `locale` is `en` or `ko`. It defaults to `en`.

`<session folder>/<agent>.json`. Only that agent writes this file, and it overwrites the whole file each time.

```json
{ "step": "tests", "done": 7, "total": 20 }
```

## Coordinator duties

1. Create the session folder. Put a `.gitignore` that holds `*` in `.claude/progress/` if none is there, so no session's files reach a commit.
2. Write `program.json` before you spawn the first agent.
3. In every agent brief, give the absolute path of its file in your session folder and the `total` it counts against, so the agent never works the path out itself. Tell it to overwrite the file after each unit of work and on each step change.
4. Move an item to `review` when its PR opens, to `done` when it merges, and from `waiting` to `active` when you spawn its agent.
5. When an agent row shows a stale warning, check on that agent.
