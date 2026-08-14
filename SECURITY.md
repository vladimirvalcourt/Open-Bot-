# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email **soni.mil2001@gmail.com** with
the details (or use GitHub's private vulnerability reporting on this repo if enabled). You'll get a
response as soon as possible, normally within a few days.

## Scope notes for researchers

- The harness server binds **127.0.0.1 only** and every non-internal API request requires a random
  per-boot app session. Remote API access is accepted only from an explicitly trusted loopback TLS
  reverse proxy and additionally requires its write-only bearer token. Any bypass is a vulnerability.
- API keys live in macOS Keychain and are write-only through the API (`configured` booleans out, never values).
  Legacy JSON secrets are removed only after a successful Keychain migration. Any path that echoes a stored secret back — API response, SSE event,
  log line, argv visible in `ps` — is a vulnerability.
- Agents run real CLIs (`claude`, `codex`) with the user's own privileges, and the permission broker
  is the consent layer for risky actions. Bypasses of the broker (approving without a user decision,
  spoofing the broker socket) are vulnerabilities.
- Provider-native `fullAuto`/`bypassPermissions` settings are normalized to centrally governed
  approval. Only exact, built-in read-only tool identifiers may be pre-authorized.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.
