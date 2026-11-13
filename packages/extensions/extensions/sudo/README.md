# Sudo

Optional Linux-only password-dialog support for `sudo` in the Power bash tool. Requires the matching AiderDesk core build with `onBashExecution` and `ExtensionContext.requestInput`; restart the main process after updating core.

Install from the extensions gallery. Run a command such as `sudo journalctl -k`. Normal bash approval and denied patterns still apply. When sudo needs authentication, the existing masked password dialog shows the command and working directory. Leave **Remember until AiderDesk closes** unchecked for one-use credentials, or check it to retain the credential in backend memory. `/sudo-forget` clears remembered passwords. Extension unload and app exit also discard them. Passwords are scoped by project and sudo authentication prompt; a repeated authentication request from the same sudo process discards the previous password. Failed bash commands conservatively clear cached credentials for that project.

The extension supplies a private per-execution PATH wrapper that invokes `/usr/bin/sudo -A`, plus `SUDO_ASKPASS`. A helper connects over a Unix socket in a random, owner-only temporary directory; only its stdout carries the password to sudo. Passwords are never included in tool arguments, environment variables, logs, or tool history. The temporary directory is prepended to PATH again after shell initialization (bash, sh/dash, zsh or fish). The wrapper, socket and environment disappear after completion, failure, cancellation or timeout. No third-party dependencies are required.

## Limitations and security

- Supports bare `sudo` found via PATH. Absolute `/usr/bin/sudo` requires an explicit `-A`; shell aliases, functions, `command -p`, nested shells that reset the environment, and remote `ssh ... sudo` may bypass the wrapper. This is not a general shell parser or remote password service. Merely mentioning sudo in a quoted string does not open a password dialog.
- Do not combine this with `sudo -S` (stdin password mode), use it to pipe passwords, or disable the askpass environment. Noninteractive `sudo -n` retains its normal behavior.
- “Use once” means AiderDesk does not retain the password. Sudo's own timestamp cache and passwordless policies are unchanged, so authentication may not be required on subsequent commands.
- Remembering a password is not approval of future commands. Existing task autonomy and bash approval settings still control command execution; autonomous mode can execute commands without an additional approval dialog.
- This is not a security boundary against the agent, installed extensions, or other processes running as your OS user. They share access to that user's files and runtime. Only enable it for trusted tasks and extensions. Privileged output can contain sensitive system information.
- Cancellation revokes the helper and closes pending prompts. The existing bash process-tree termination is best-effort: an unprivileged app cannot guarantee termination of already elevated children. Do not rely on timeout/cancellation to stop a root-owned operation.
- Linux only for now. macOS and Windows are not enabled.
