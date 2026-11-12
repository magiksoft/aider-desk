# Agent Browser

Browser automation tools for AiderDesk agents, powered by the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI.

The agent gets a browser it drives one command at a time: `snapshot` returns the page as a compact accessibility tree with element refs (like `@e12`), the agent acts on those refs (click, fill, type), reads the page again to verify the result, and repeats. The browser stays alive between commands, so each step is one short call.

## How it works

- **CLI resolution order**: the `AGENT_BROWSER_BIN` environment variable (if set) → a globally installed `agent-browser` binary → the CLI bundled with the extension as an npm dependency. The bundled fallback means the extension works out of the box, while a global install always wins so users can control upgrades.
- **Per-project sessions**: every command runs with `--session <project-name>`, giving each AiderDesk project its own isolated browser and daemon.
- **Skills**: the extension provides the `agent-browser-core` skill (plus `dogfood` for exploratory testing and `electron` for automating Electron apps). Skills are refreshed with the latest content from the agent-browser repo on install and re-fetched in the background whenever they are older than a week. If fetching fails, the version-matched content shipped inside the bundled CLI package is used, so skills are always available.

## Tools

| Tool | Purpose |
| --- | --- |
| `agent_browser_open` | Launch the browser (headless by default) and open a URL |
| `agent_browser_snapshot` | Get the accessibility tree with element refs |
| `agent_browser_click` | Click an element by ref or selector |
| `agent_browser_fill` | Clear and fill an input by ref or selector |
| `agent_browser_screenshot` | Capture a screenshot into a file |
| `agent_browser_close` | Close the browser |
| `agent_browser_execute` | Run any other agent-browser CLI command (`get`, `eval`, `wait`, `console`, `cookies`, `tab`, ...) |
| `agent_browser_install` | One-time download of the Chrome for Testing binary |

```
npm install -g agent-browser && agent-browser install
```

## First use

1. Enable the extension (global install recommended so the 52MB bundled CLI is downloaded once).
2. Enable the agent-browser tools in the agent profile (or leave all extension tools enabled).
3. When a task first uses a browser tool, the CLI downloads Chrome for Testing via `agent_browser_install` (roughly 150MB, one time per machine).

## Configuration

- `AGENT_BROWSER_BIN` — absolute path to a specific agent-browser binary to use.

## UI

By default, screenshots are saved to `agent-browser-screenshots/` inside the task's data directory (`.aider-desk/tasks/<task id>/`), so they never pollute the working repository; a custom path can be passed and is resolved relative to the task working directory.

All `agent_browser_*` tool messages are rendered with custom task-message components. The `agent_browser_screenshot` component shows the saved file path and the screenshot image inline (click to enlarge); the other tools (`open`, `snapshot`, `click`, `fill`, `close`, `execute`, `install`) share one component that shows a tool-specific title, arg summary rows (URL, selector, command, session, …) and the CLI output in a scrollable code block. The screenshot image is also attached to the tool result itself (`media` part), so the model can analyze it immediately without reading the file from disk.

## Skills

The skills are served from `<extension>/skills/` and teach the agent the snapshot-and-ref workflow, wait/retry patterns, session/auth handling, and specialized use cases. The agent's first activation of `agent-browser-core` covers most web tasks; it routes to references and other skills when a task needs more detail.
