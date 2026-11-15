# progress-band

A live progress bar above the Claude Code prompt for multi-agent work. When you run a long job with several background subagents, the band shows the overall percent, one row per running agent, and what comes next. It refreshes every 5 seconds from small JSON files, so you can see at a glance which agent is moving and which one has stalled.

```
API migration ██████████████░░░░░░░░░░ 59%  done 5/9
  Billing   █████████░ 25/28 screenshots
  Search    ██░░░░░░░░ 4/20 code
  next · Accounts → Cleanup
```

## Install

```
/plugin install progress-band --marketplace yungblud/progress-band
```

Answer `y` to add the marketplace, then pick a scope.

## How it works

The plugin reads `.claude/progress/<session id>/` under the session's project root, so two terminals open in the same repo each draw their own band, and a shell `cd` into a subfolder does not hide it. The skill has Claude find the folder from `$CLAUDE_CODE_SESSION_ID`, which Claude Code sets in the Bash tool's environment. Plugins cannot inject that path into the model's context where an organization's security plugin answers the context hooks first. With no `program.json` there, it draws nothing, so it is safe to install globally.

- `program.json` lists the work items. Only the coordinator writes it.
- `<agent>.json` holds one agent's progress, `{ "step": "tests", "done": 7, "total": 20 }`. Only that agent writes it.

One writer per file means agents never race on the same file. An agent row turns yellow when its file has not changed for `staleMinutes` (15 by default).

The plugin ships a `progress-band` skill that tells Claude how to keep these files: write `program.json` before spawning agents, give each agent the absolute path of its own file, and move items through `waiting → active → review → done`. Ask Claude to "show progress as a bar" and it follows the skill.

### program.json

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

| Field | Meaning |
| --- | --- |
| `state` | `done`, `review` (PR waiting for merge), `active`, or `waiting` |
| `weight` | The item's share of the whole job, such as its file count. Defaults to 1 |
| `agent` | The name of the item's progress file, `<agent>.json` |
| `locale` | `en` or `ko` for the band's own words. Defaults to `en` |

The overall percent weights each item. A `done` item counts fully, a `review` item counts 95%, and an `active` item counts up to 90% of its weight by its agent's `done / total`.

## Development

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

## License

MIT
