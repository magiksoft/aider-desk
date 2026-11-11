---
title: "Source Code Map"
sidebar_label: "Source Code Map"
---

# Source Code Map

AiderDesk separates its Electron main process, React renderer, preload bridge, and shared packages. Use this guide to find the subsystem relevant to a task rather than loading the entire repository into an agent's context.

Links below follow the `main` branch of [magiksoft/aider-desk](https://github.com/magiksoft/aider-desk). For release-specific behavior, switch to the corresponding tag. Folder links are for browsing; entry-point links serve raw source that agents can fetch directly. Read the repository's [contributor instructions](https://raw.githubusercontent.com/magiksoft/aider-desk/main/AGENTS.md) before making changes.

## Desktop application and process boundaries

- [Main process](https://github.com/magiksoft/aider-desk/tree/main/src/main): Application lifecycle, windows, project management, and backend services. Start at [index.ts](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/main/index.ts).
- [Preload bridge](https://github.com/magiksoft/aider-desk/tree/main/src/preload): Exposes the desktop application API securely to the renderer. Start at [index.ts](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/preload/index.ts).
- [Shared API and types](https://github.com/magiksoft/aider-desk/tree/main/packages/common/src): Cross-process contracts, schemas, utilities, and translations. Start at [api.ts](https://raw.githubusercontent.com/magiksoft/aider-desk/main/packages/common/src/api.ts).
- [IPC handlers](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/main/ipc-handlers.ts): Connects renderer requests to main-process services.

When changing an application API, trace the shared contract, main-process implementation, preload bridge, browser client, and REST endpoint together.

## Agents, tasks, and models

- [Agent runtime](https://github.com/magiksoft/aider-desk/tree/main/src/main/agent): Model execution, message preparation, compaction, subagents, MCP connections, and durability. Start at [agent.ts](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/main/agent/agent.ts).
- [Built-in agent tools](https://github.com/magiksoft/aider-desk/tree/main/src/main/agent/tools): File operations, shell execution, task management, and tool approval.
- [Task management](https://github.com/magiksoft/aider-desk/tree/main/src/main/task): Task lifecycle, conversation context, and Aider process coordination. Start at [task.ts](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/main/task/task.ts).
- [Project management](https://github.com/magiksoft/aider-desk/tree/main/src/main/project): Project lifecycle and task creation.
- [Model providers](https://github.com/magiksoft/aider-desk/tree/main/src/main/models): Provider integrations and model discovery.
- [Git integration](https://github.com/magiksoft/aider-desk/tree/main/src/main/git): Branches, worktrees, diffs, commits, and integration operations.
- [Skills](https://github.com/magiksoft/aider-desk/tree/main/src/main/skills), [memory](https://github.com/magiksoft/aider-desk/tree/main/src/main/memory), and [prompts](https://github.com/magiksoft/aider-desk/tree/main/src/main/prompts): Reusable instructions, persistent agent memory, and prompt management.

## User interface

- [Renderer](https://github.com/magiksoft/aider-desk/tree/main/src/renderer/src): React application. Start at [App.tsx](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/renderer/src/App.tsx).
- [Components](https://github.com/magiksoft/aider-desk/tree/main/src/renderer/src/components): Chat messages, prompt input, project/task navigation, settings, and common UI controls.
- [Stores](https://github.com/magiksoft/aider-desk/tree/main/src/renderer/src/stores): Shared reactive application state.
- [Hooks](https://github.com/magiksoft/aider-desk/tree/main/src/renderer/src/hooks): Reusable renderer behavior and subscriptions.
- [Browser client](https://raw.githubusercontent.com/magiksoft/aider-desk/main/src/renderer/src/api/browser-api.ts): ApplicationAPI implementation for browser access.
- [Translations](https://github.com/magiksoft/aider-desk/tree/main/packages/common/src/locales): Shared localized UI strings.

## Extensions and external integrations

- [Extension runtime](https://github.com/magiksoft/aider-desk/tree/main/src/main/extensions): Extension loading, lifecycle, events, and execution contexts.
- [Extension interfaces](https://raw.githubusercontent.com/magiksoft/aider-desk/main/packages/common/src/extensions.ts): Source of truth for the extension API; generated declaration files should not be edited directly.
- [Extensions package](https://github.com/magiksoft/aider-desk/tree/main/packages/extensions): Extension tooling and bundled extension implementations.
- [HTTP server](https://github.com/magiksoft/aider-desk/tree/main/src/main/server): Browser serving, server startup, and remote access.
- [REST endpoints](https://github.com/magiksoft/aider-desk/tree/main/src/main/server/rest-api): HTTP routes and request validation.
- [MCP server package](https://github.com/magiksoft/aider-desk/tree/main/packages/mcp-server): Standalone MCP integration for external clients.
- [Aider connector](https://github.com/magiksoft/aider-desk/tree/main/resources/connector): Python integration with Aider; paired with [main-process connector code](https://github.com/magiksoft/aider-desk/tree/main/src/main/connector).

## Packaging, parsing, and documentation

- [App package](https://github.com/magiksoft/aider-desk/tree/main/packages/app): Published application package and CLI tooling.
- [Tree-sitter utilities](https://github.com/magiksoft/aider-desk/tree/main/packages/tree-sitter-utils): Source parsing utilities and resources.
- [Build scripts](https://github.com/magiksoft/aider-desk/tree/main/scripts): Build preparation, packaging, and development utilities.
- [Documentation site](https://github.com/magiksoft/aider-desk/tree/main/docs-site): Docusaurus documentation, static assets, and the published `/llms.txt` navigation index.

## Tests and on-demand context bundles

Tests live beside the relevant subsystems in `__tests__` directories. See [Development Setup & Contributing](./development.md) for test and type-check commands.

For a whole-repository review in a chat assistant, generate a local Repomix bundle using the checked-in configuration:

```bash
npx repomix
```

The configuration includes `src`, `packages`, the Python connector, scripts, and selected build configuration. The generated `repomix-output.txt` is ignored by Git; it is not published or committed automatically. Review its contents before sharing it externally. Prefer targeted source reads for ordinary coding tasks to avoid unnecessary context and stale snapshots.
