# OpenMausBot feature guide

This guide describes what the current source tree implements. It distinguishes working local features from integrations that require user setup and policy foundations that are not yet hosted services.

## Product in one sentence

OpenMausBot is a local-first macOS desktop workspace where multiple AI agents appear as chat contacts, run through the provider tools or APIs you choose, and share one governed layer for approvals, computers, browsers, connected apps, durable work, memory, and routines.

## Feature status

| Status | Meaning |
|---|---|
| Available | Implemented in the desktop app and local harness. |
| Setup required | Implemented, but needs a provider login, credential, macOS permission, or external service. |
| Foundation | The local model and controls exist, but a hosted enforcement or enterprise service is not included. |

## Bots and conversations

| Capability | Status | What it does |
|---|---|---|
| Multiple bots | Available | Create separate agents with their own name, title, description, color, model selection, project, thread, and computer preference. |
| Persistent conversations | Available | Messages and canonical runtime events are stored locally and restored after restart. |
| Streaming turns | Available | Provider output, tool activity, approval requests, errors, and completion state stream into the selected thread over SSE. |
| Model switching | Available | Change the provider/model assigned to a bot without creating another workspace. Unavailable providers show their reason. |
| Prompt enhancement | Available | A provider can restructure a rough prompt; a deterministic local rewrite is used if the provider is unavailable or times out. |
| Attachments | Available | Attach up to ten approved files to a turn. Each file is limited to 20 MB and stored in the private local attachment vault. |
| Dictation | Setup required | The packaged macOS app uses Apple's speech recognizer after microphone and speech-recognition permission is granted. |
| Bot organization | Available | Pin, hide, duplicate, mark unread, assign sections/projects, edit profiles, and delete bots. |
| Bot-to-bot requests | Available | Compatible agents can discover peers and ask another bot one bounded-hop question; cross-talk appears in the visible audit trail. |

## Providers and models

OpenMausBot normalizes every provider into one driver contract and canonical event stream. A missing or unhealthy provider becomes unavailable instead of crashing the fleet.

| Provider path | Status | Authentication and notes |
|---|---|---|
| Claude CLI | Setup required | Uses the locally installed and signed-in Claude CLI. |
| Codex CLI | Setup required | Uses the locally installed and signed-in Codex CLI. |
| Grok / Grok Build | Setup required | Uses the supported local CLI path or configured xAI credential, depending on the selected driver. |
| Gemini CLI | Setup required | Uses Gemini CLI's official Google sign-in flow; OpenMausBot does not request the OAuth credential. |
| Kimi Code CLI | Setup required | Uses device-code login and an isolated provider home under `~/.openmausbot/providers/kimi-code`. |
| OpenAI-compatible APIs | Setup required | Add a display name, model ID, API key, and HTTPS base URL for another compatible provider. Plain HTTP is accepted only for loopback-hosted local models. The key remains server-side. |
| Box computer agent | Setup required | Optional cloud-computer backend using a Box token. |

Provider configuration hot-reloads the fleet. Secrets are never returned to the renderer; API responses expose only configured/not-configured state.

## Work, teams, and projects

| Capability | Status | What it does |
|---|---|---|
| Durable Work inbox | Available | Records tasks, attempts, run status, output, tool calls, token counts, failures, interruptions, approvals, checkpoints, and audit events. |
| Central approvals | Available | Permission and question requests from all bots appear in one queue and can be allowed, denied, or answered. |
| Retry failed work | Available | Starts a new attempt for failed or cancelled tasks while retaining earlier run history. |
| Team assignments | Available | Runs one assignment on two to eight selected bots in parallel, subject to the configured concurrency ceiling. Each bot keeps its own thread and audit trail. |
| Projects | Available | Group bots and tasks under named projects and filter the Work view by project. |
| Knowledge sources | Available | Add URL, file, or note references with provenance and last-verified timestamps. Sources are injected as reference material, not trusted instructions. |
| Workflow replay | Available | Reconstruct a run from its timeline, checkpoints, and approvals. |
| Checkpoint restore | Available | Restores only checkpoints explicitly marked reversible. It does not pretend that arbitrary external actions can be rolled back. |

Team assignments currently preserve separate contributions; automatic synthesis into one merged team response is not included yet.

## Memory

- Save facts, preferences, project context, and procedures for one bot or the shared workspace.
- Search relevant memory from compatible agents.
- Memory writes are explicit policy actions: agents are instructed to save only when the user asks them to remember something.
- Delete any memory from the Memory panel.
- Memory is local data and is included in encrypted workspace backups.

## Routines and triggers

| Capability | Status | Notes |
|---|---|---|
| Scheduled routines | Available | Once, hourly, daily, weekdays, weekly, monthly, and yearly cadences. |
| Timezone-aware wall clock | Available | Uses an explicit IANA timezone and calculates future runs across daylight-saving changes. |
| Manual run | Available | Run a routine immediately without changing its next scheduled occurrence. |
| Webhook/email-style trigger | Available | Creates a per-routine secret trigger URL and treats the submitted payload as untrusted context, not instructions. An external email ingestion service is not bundled. |
| Bounded retry | Available | Configurable retry limit from zero to five. |
| Teach a task | Available | Record an embedded-browser workflow, redact entered values, review it, and save it as a paused routine before enabling it. |
| Run history | Available | Last run time, status, errors, and durable Work records remain visible. |

## Browser and computer use

### Embedded browser

- Each bot gets an isolated persistent browser session.
- Agents can navigate, inspect the accessibility tree, click stable element references, type, wait, and capture screenshots.
- Users can take over the visible browser for sign-in, CAPTCHA, or review.
- Navigation is validated by the desktop bridge; browser actions remain subject to Trust Center policy.
- Google and other providers may block OAuth inside embedded webviews. Use a normal browser for those login flows.

### This Mac

The packaged macOS app embeds the signed CUA driver and owns the Accessibility and Screen Recording permission relationship. Supported operations include screen and window state, accessibility inspection, screenshots, clicks, typing, keyboard shortcuts, scrolling, dragging, app launching, and foreground control.

This capability is setup required: macOS must grant the relevant permissions. OpenMausBot does not bypass TCC or silently grant itself access.

### Cloud computers

- GitHub Codespaces can provide an isolated Linux shell using a repository, branch, optional machine type, and a scoped GitHub token.
- Box remains an optional cloud-computer backend.
- Computer lifecycle includes provision, join, sleep, command execution where supported, and screenshots.
- Credentials remain server-side and are passed only to the relevant bundled or provider process.

## Connected apps

The Plugins marketplace uses a Composio Platform API key to discover and authorize apps such as Gmail, Slack, GitHub, Notion, and Linear. OAuth happens through the provider's authorization flow. Connected-app tools are routed through a local integration proxy so provider credentials are not injected into agent prompts or ordinary process arguments.

Drafting content does not authorize sending or publishing it. The capability router treats explicit action verbs such as send, post, create, schedule, save, or delete as the requested action, still subject to Trust Center policy. After an external mutation, agents are instructed to verify the resulting provider state and report concrete evidence.

## Mission Control

Mission Control brings operational and policy controls into one view:

- Active bots, pending approvals, failures, schedules, success rate, token totals, known cost, and checkpoint totals.
- Provider health and cloud-computer readiness.
- Emergency stop and resume.
- Default and per-bot autonomy modes.
- Scoped temporary or persistent allow/deny rules by bot, tool, and resource pattern.
- Commercial setup certification for profile, provider, Keychain, browser, computer, limits, and trust readiness.
- Privacy settings, diagnostics, encrypted backup/import, templates, projects, knowledge sources, and local organization policy.
- Stable/beta release-channel preference.

### Enterprise policy boundary

Organization members, roles, and OIDC/SAML requirements are a **foundation** in the local build. They record intended workspace policy, but hosted identity verification and enforcement require an external identity gateway that is not included in this repository. The UI says this explicitly and SSO should remain disabled for a local-only deployment.

## Security and trust

### Approval enforcement

- `Observe` denies action tools.
- `Draft` allows preparation but denies actions.
- `Approve` asks before action tools.
- `Auto` automatically allows only an exact server-owned list of read-only tools.
- Unknown tools, shell commands, edits, clicks, navigation, and connected-app calls fail closed to approval.
- Provider-native `fullAuto` and permission-bypass options are normalized away so the central policy remains authoritative.
- Emergency stop overrides every allow rule.

### Local API authentication

- The harness listens on `127.0.0.1`.
- The packaged desktop app generates a random per-boot application token.
- Local API requests require that token through the app session.
- Internal peer-agent endpoints use a separate secret and accept loopback callers only.
- Cross-origin API requests are restricted to explicit local or configured origins.

### Remote access

- The harness must never be exposed directly to a LAN or the internet.
- Remote mode keeps the Node server on loopback and accepts forwarded requests only from an explicitly trusted loopback proxy.
- The proxy must attest HTTPS with `X-Forwarded-Proto: https`.
- Protected remote API calls require a separate random bearer token.
- See [remote-access.md](remote-access.md) for the required topology and examples.

### Credential protection

- Packaged macOS builds consolidate provider credentials into one `vault.v1` Apple Keychain item.
- The vault is read once and cached for the server process, avoiding repeated Keychain prompts during normal use.
- Legacy per-secret records are copied into the vault before they are deleted, so a cancelled prompt or failed write does not lose credentials.
- Configuration endpoints return booleans, never stored secret values.
- Integration credentials are delivered through bounded, permission-restricted local mechanisms rather than shell-built command strings.
- Logs and diagnostics redact credential-like material.

### Local data protection

- `~/.openmausbot` directories are repaired to mode `0700`; regular sensitive files are repaired to `0600` without following symlinks.
- Attachment names and extensions are allowlisted, payload size is bounded, and server paths are never returned to the renderer.
- Backup restore rejects unknown paths, traversal, oversized expansion, malformed envelopes, and incorrect passphrases.
- Encrypted backups use AES-256-GCM with a scrypt-derived key and exclude configuration credentials.
- Diagnostics exclude credentials and omit run output unless the user explicitly enables content inclusion.
- Analytics and crash-report preferences are off by default.

## Storage and privacy

Default local data directory: `~/.openmausbot/`

| Data | Storage |
|---|---|
| Bots and thread metadata | Local JSON |
| Messages and canonical events | Local JSON/NDJSON |
| Tasks, runs, approvals, checkpoints, and audits | Local JSON |
| Projects, knowledge references, memory, routines, and governance | Local JSON |
| Attachments | Private local attachment directory |
| Provider secrets | Apple Keychain in packaged macOS builds |
| Embedded-browser sessions | Per-bot persistent Electron session partitions |

OpenMausBot does not make a cloud-sync promise. Any external provider or connected app receives the data required for the action the user asks that provider to perform, under that provider's own terms.

## Backups and diagnostics

- Export an encrypted `.omb.json` envelope protected by a passphrase of at least ten characters.
- Backups include workspace content and exclude provider credentials.
- Import requires the literal confirmation `IMPORT`, validates every path, writes through temporary files, and requires an app restart afterward.
- Download a redacted diagnostic snapshot containing platform metadata, configured/not-configured states, provider health, counts, policy state, and recent failure metadata.
- Run output appears in diagnostics only when separately opted in.

## Templates

The repository includes Executive Office, Research Lab, Marketing Studio, and Development Team starting points. Applying a template creates its project and specialized bots. Included routines are installed paused so the user can inspect them before anything runs.

## Developer and release tooling

- TypeScript project references cover the React app and Node harness.
- Vitest covers stores, drivers, API contracts, security policy, browser navigation, backups, attachments, routines, projects, and related behavior.
- Playwright covers critical desktop UI flows.
- CI runs type checking and tests on macOS, Ubuntu, and Windows; Ubuntu also runs security and trust evaluations plus the production UI build.
- `pnpm commercial:check` combines type checking, tests, the static security scan, trust-policy evaluations, and a production build.
- macOS packaging compiles the Swift speech and Keychain helpers, bundles pinned/checksummed CUA and GitHub CLI artifacts, signs nested binaries, and creates DMG/ZIP artifacts.
- `pnpm verify:mac -- <app>` verifies the app layout, architectures, signing relationship, hardened runtime, and release-signing expectations.

## Current boundaries

- The packaged desktop product targets Apple silicon macOS. The Node harness and CI are more portable, but Windows and Linux desktop shells are not shipped.
- Public release readiness still requires a Developer ID Application signature, notarization, stapling, and release-repository publication. A local Apple Development signature is suitable only for local testing.
- SSO fields and organization roles are local policy foundations, not hosted authentication enforcement.
- Team tasks do not yet synthesize a single merged response automatically.
- Email-style routine triggers expose a secure trigger mechanism; they do not include a hosted inbound-email gateway.
- Provider availability, quotas, billing, OAuth behavior, and external tool results depend on the configured third-party service.
- Encrypted backup is local export/import, not continuous sync or disaster-recovery hosting.

## Further reading

- [README](../README.md)
- [Security policy](../SECURITY.md)
- [Remote access](remote-access.md)
- [Computer-use integration](computer-use-integration.md)
- [Contributing](../CONTRIBUTING.md)
