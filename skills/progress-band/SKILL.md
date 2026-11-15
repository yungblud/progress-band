---
name: progress-band
description: Keep the progress-band files up to date while you coordinate subagents, so the person sees a live progress bar above the prompt. Use when you run multi-step work with background subagents, or when the person asks to see progress as a bar.
---

# progress-band

The `progress-band` plugin draws a bar above the prompt from files in `.claude/progress/` under the session's working directory. It reads them every 5 seconds. With no `program.json` it draws nothing.

## Files

One writer per file, so no two agents ever write the same file.

`.claude/progress/program.json`. Only the coordinator writes this file.

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

`.claude/progress/<agent>.json`. Only that agent writes this file, and it overwrites the whole file each time.

```json
{ "step": "tests", "done": 7, "total": 20 }
```

## Coordinator duties

1. Create the folder with a `.gitignore` that holds `*`, so the files never reach a commit.
2. Write `program.json` before you spawn the first agent.
3. In every agent brief, give the absolute path of its file and the `total` it counts against. Tell it to overwrite the file after each unit of work and on each step change.
4. Move an item to `review` when its PR opens, to `done` when it merges, and from `waiting` to `active` when you spawn its agent.
5. When an agent row shows a stale warning, check on that agent.
