# Runtime resilience review - 1.5.3

## Baseline and scope

Baseline: `main` at `0fc2165`, application 1.5.2, clean working tree.
Before implementation, `bun run verify` passed TypeScript and 42 tests
(73 assertions), `bun run build` passed, and `bun run smoke` passed in
real Electron on Windows. No open issue or PR existed for this work.
Task branch: `issue-runtime-resilience`.

Reviewed the Electron composition root, navigation and IPC trust boundaries,
preload surface, settings and window storage, Discord transport, updater,
packaging allowlist and CI/release configuration. Retain the existing domain,
port and adapter boundaries rather than replacing the runtime or framework.

## Findings and implementation

1. Discord IPC accepted signed payload lengths without checking bounds.
   A negative length could stop parser progress; an oversized incomplete
   payload retained incoming data indefinitely. JSON `null` could also throw
   when inspecting `evt`. Repeated buffer concatenation copied the entire
   incomplete frame for each chunk.
   The transport now uses an isolated, streaming frame decoder. It validates
   lengths before allocation, limits payloads to 1 MiB, copies each byte once
   into an 8-byte header or the payload buffer, and treats decoded JSON as
   unknown. Malformed JSON or lengths close the connection and use the
   existing 20-second retry policy. Fragmentation, coalescing and UTF-8 work
   across arbitrary chunk boundaries.
2. In-flight Discord sockets were not owned by the lifecycle. Disabling or
   changing the application ID could leave an old attempt alive, and stale
   callbacks could mutate the next attempt's connecting state. A peer that
   accepted but never sent READY prevented reconnection indefinitely.
   Pending sockets and connection/handshake timers are now owned and cleared
   alongside the active socket. Each connection or handshake has a 5-second
   timeout. Generation checks isolate old callbacks. Quitting disables
   presence, cancelling pending sends and retries and releasing sockets.
3. Each move/resize event synchronously serialized and wrote window state on
   Electron's main thread. A trailing 250 ms task now coalesces these events;
   close flushes the latest state immediately, and closed cancels the task.
   Explicit display operations still save immediately. Display reads take
   one settings snapshot instead of three disk reads, and a validated patch
   writes Discord, V-Sync and ANGLE settings in a single atomic replacement
   instead of up to three.

## Compatibility and version

**1.5.2 -> 1.5.3 (PATCH)**: internal reliability and performance fixes with
regression coverage. `package.json` and both npm lock root versions agree.
`bun.lock` contains no application version field and needs no change; no
dependency versions change. Existing desktop bridge methods, settings keys,
defaults, distribution schema 1.0.0, GPU switches, profile paths and update
opt-in policy remain intact. No player-data migration is required.

Unexpected termination can lose up to 250 ms of the latest window movement;
normal close flushes before the window is destroyed. A corrupt or unsupported
Discord peer is disconnected instead of being allowed to grow memory or
stall the parser. The 1 MiB cap is far above the activity payloads this client
sends, but deliberately rejects larger incoming frames.

## Measurement and validation

Run `bun run benchmark:state` to build and compare actual filesystem writes
for 500 synthetic window events, including serialization and directory
checks. Both paths assert identical final state. On this Windows machine,
Node 26.13.1, five rounds produced median 69.9762 ms for the original path
and 0.3389 ms for the coalesced path. Writes fell from 500 to 1 (99.8%).
Reports and fixture files are in ignored `out/state-benchmark-*/`. This is
a burst/flush benchmark of main-thread persistence work, not a sustained
drag workload, game FPS, GPU or end-to-end latency measurement. The normal
250 ms idle delay is not included in these CPU/wall-work measurements.

Regression tests cover arbitrary frame splits, multiple frames per chunk,
maximum payload, negative/zero/oversized lengths, malformed JSON, ping/pong,
latest activity, handshake timeout, disable/re-enable, application changes,
disabling a pending connection, unavailable endpoints and CLOSE handling.
Transport tests use actual local IPC
servers, without contacting Discord or changing the player profile. Task
tests cover burst coalescing, latest state, immediate close flush, cancellation
and reuse. The real Electron smoke test checks combined settings persistence,
saved bounds, bridge input rejection and subscription cleanup.

Final local verification on Windows:

- `bun install --frozen-lockfile`: PASS, no dependency changes.
- `bun run verify`: PASS, TypeScript and 52 tests (156 assertions).
- `bun run smoke`: PASS against source in Electron 44.7.1.
- `bun run benchmark:state`: PASS, five measured rounds as reported above.
- `bun run electron-builder --win --dir --publish never
  --config.directories.output=out/package-review-1.5.3
  --config.electronDist=node_modules/electron/dist`: PASS. The existing local
  Electron distribution was used, and no installer or release was published.
- `node scripts/check-package.mjs
  out/package-review-1.5.3/win-unpacked/resources/app.asar`: PASS, including
  both new adapters, version agreement and diagnostic exclusion.
- `node scripts/smoke.mjs
  out/package-review-1.5.3/win-unpacked/PokeBonk.exe`: PASS against the packaged
  executable with a separate profile.
- `node --check` for the three modified/new diagnostic scripts and
  `git diff --check`: PASS.

The smoke test intentionally submits an invalid Discord setting and observes
its rejection; Electron logs that expected error while the test passes.

macOS/Linux CI, the real Discord client, sustained gameplay and installed
updater cycles require their respective environments. No claims of improved
game FPS or reduced installer size are made.

## Rollback

The baseline checkout can be used independently of this task branch. To
revert after integration, make a forward revert with a new patch version;
existing profiles need no downgrade or migration. No merge, tag, publication
or deployment is part of this work.
