# Memory and frame stability optimization

## Objective and acceptance

Reduce retained and transient client memory while reducing frame-time variation at the same game settings and refresh rate. Higher average FPS alone is not an improvement. Keep the existing game origin, saves, display API, V-Sync defaults, hardware rendering, Vulkan presentation fix and background co-op scheduling.

Compare the same executable/runtime, GPU backend, resolution, display refresh, workload and foreground state. Warm up before sampling; alternate baseline/candidate order across at least three runs. Record frame intervals (median, P95, P99, standard deviation and consecutive-frame variation), intervals above 1.5 times the target budget, and intervals above 50 ms. Report average FPS only as context. A 60 Hz target has a 16.67 ms budget; use the actual target when testing other refresh rates.

Record process memory separately for Browser, Tab, GPU and utility processes. On Windows, sum private bytes for the app's owned processes and also report working sets; working-set sums can double-count shared pages. JS heap alone excludes native buffers and GPU resources. Record peak sampled memory, settled memory and process counts. A sample peak is a lower bound on the true peak. Do not use forced GC, cache clearing, a smaller heap limit or software rendering to manufacture savings.

Accept a runtime change only when its affected allocation/work count decreases, functional checks pass, and repeated frame measurements show no consistent P95/P99 or long-frame regression. Gameplay acceptance additionally needs the same reproducible combat scenario and input on both versions; a local WebGL fixture establishes shell behavior only. Reject a trade that saves memory by introducing recurrent stalls.

## Current evidence (2026-11-18)

- Baseline: `0564bf2`, application 1.5.4, Electron 44.7.1, Bun 1.4.4, Node.js 26.13.1. TypeScript checks, 52 tests / 156 assertions and the bridge, offline and splash Electron smoke flows pass locally on Windows.
- This repository hosts the online game. It does not contain combat simulation, particle systems, texture caches or the game's frame limiter. Their optimization requires the owning game source and a repeatable gameplay capture.
- Discord framing is already bounded to 1 MiB, and window persistence already coalesces move/resize bursts. Preserve those improvements.
- `DiscordPresence.connect` copies each socket Buffer before the parser copies bytes into its bounded frame buffer. Outbound framing creates a JSON body Buffer, header Buffer and concatenated Buffer. Both paths can remove allocations without changing bytes on the wire.
- `watchBoot` polls every 200 ms; unchanged progress still calls `executeJavaScript` on the splash renderer. Each `dom-ready` can start another watcher, and watcher timers have no explicit owner cancellation. The splash WebContents is already closed after its fade; do not claim an existing permanent renderer leak.
- The 4096 MiB V8 flag is a heap ceiling, not a measurement of resident memory. Changing it without a survival workload could increase GC pauses or crashes.

## Ordered implementation

| Stage | Work | Validation and exit condition |
| --- | --- | --- |
| 1. Measurement | Add opt-in diagnostics using the existing isolated self-test, a bounded frame collector and per-process memory samples. Add a repeatable local WebGL benchmark and a Discord transport allocation benchmark. Keep diagnostics out of normal play and packaged tools. | Verify percentile/variation calculations against known samples; run the unmodified runtime first and save raw reports under ignored `out/`. |
| 2. Transport allocations | Encode Discord frames directly into one output Buffer; pass socket Buffers directly to the existing synchronous parser. Keep frame bounds, UTF-8 and connection lifecycle intact. | All framing/lifecycle tests pass; wire bytes match including non-ASCII strings; allocation benchmark reports fewer bytes allocated/copied at the same payload. |
| 3. Startup work and ownership | Deduplicate identical displayed progress. Give the boot polling chain one cancellable owner; stop it on navigation, splash removal and window close, including in-flight reads. | Tests cover duplicate starts, cancellation, rejection and stale completion. Electron smoke confirms progress and both menu/interactive-loading exits; resource reports show the extra splash contents disappear. |
| 4. Comparison and review | Alternate baseline/candidate WebGL runs and compare memory, frame distributions, long frames and work counts. Run full local checks, packaging and CI; publish reviewable changes with evidence. | Report measured results with workload limits. Do not call game FPS/memory improved on the basis of transport or startup microbenchmarks. |

## Evidence-dependent follow-up

Use the diagnostic command against the live game for a controlled menu, fixed combat, busy survival and co-op-host session. Capture at least 60 seconds per scenario after warm-up, then a 30-minute survival soak with repeated scene transitions. Compare retained memory after the same transitions and P95/P99 frame times, not a single Task Manager reading. Use an isolated diagnostic profile; provide an explicit setup script when a repeatable scenario needs game inputs.

Only investigate backend changes, heap ceilings, cache policy or frame limiting if these captures identify their cost. Preserve the player's chosen backend and the existing Windows Vulkan presentation path. Background throttling stays disabled because it participates in co-op hosting. A stable lower cap belongs at the game's existing frame-limiter boundary; do not wrap global `requestAnimationFrame` or insert an independent timer loop in the desktop preload.

If allocation or frame spikes belong to game assets/simulation, the next implementation must be in the game repository: identify retained owners, release scene-owned GPU resources at transitions, bound proven caches, reuse measured hot-path allocations and spread proven burst work over frames. Establish that evidence before choosing pooling, cache budgets or a new runtime.

## Progress

- Stage 1 implemented: `bun run benchmark:runtime` uses the existing isolated self-test. `--selftest-metrics` samples process metrics once per second, up to 600 samples; frame capture uses a bounded 36,000-element typed array. `--duration`, `--warmup`, `--hz`, `--app`, `--url` and `--setup` support controlled comparisons. Focus loss, visibility and sample caps are explicit validity fields. No timers or samples are added to normal play.
- Initial Windows baseline: Intel Iris Xe / ANGLE D3D11, 60 Hz, 1280x720 outer window, 1266x686 content DIP at 1.25 scale, 2 s warm-up + 8 s capture. 480 intervals: median 16.7 ms, P95 16.8 ms, P99 16.9 ms, standard deviation 0.124 ms; zero over-budget or >50 ms intervals. Sampled peak private bytes 314,812 KiB; settled private bytes 234,908 KiB. Boot reads 7, splash writes 9, settled WebContents 1. Raw report: `out/runtime-benchmark-1795007679009/`. This is the first baseline run, not a repeated comparison.
- Stage 2 implemented: `src/discord-frames.ts` encodes a frame directly into one 8-byte-header-plus-body buffer, and the inbound parser consumes complete frames in place. `bun run benchmark:discord` measures 3 to 1 Buffer allocations per frame, 12,200,000 to 6,100,000 allocated bytes over 20,000 frames, and removes the concatenation copy entirely; encoded bytes are identical, including UTF-8 lengths.
- Stage 3 implemented: `src/boot-watch.ts` owns one cancellable poll with generation checks. Navigation, splash removal, screen discovery, an interactive load, timeout and window close stop it; an in-flight read cannot emit after cancellation. `splashSet` does not repeat an unchanged progress-and-label IPC write. The delayed hide after the menu appears also requires the progress it raised, so a navigation inside those 350 ms cannot be hidden by the previous page's timer. The splash still closes after its fade, so this is not a permanent splash-renderer leak fix.
- Stage 4 Windows comparison, local WebGL fixture (2 s warm-up, 12 s capture, three alternating runs):

| Version | P95 (ms) | P99 (ms) | Std. dev. (ms) | Over 50 ms | Settled private (KiB) |
| --- | --- | --- | --- | --- | --- |
| Baseline `db077aa` | 16.9-17.2 | 17.3 | 0.174-0.275 | 0 | 231,972-236,540 |
| Candidate | 16.9-17.1 | 17.1-17.3 | 0.177-0.226 | 0 | 231,980-236,248 |

- Stage 4 Windows comparison, live `https://pokebonk.com` (10 s warm-up, 22 s capture, alternating pairs):

| Version | P95 (ms) | P99 (ms) | Std. dev. (ms) | Over 50 ms | Boot reads / splash writes | Settled private (KiB) |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline B1 | 16.9 | 17.2 | 0.186 | 0 | 12 / 8 | 737,136 |
| Candidate C1 | 16.9 | 17.1 | 0.151 | 0 | 21 / 7 | 733,584 |
| Baseline B2 | 16.9 | 17.0 | 0.144 | 0 | 2 / 4 | 720,864 |
| Candidate C2 | 16.9 | 17.1 | 0.142 | 0 | 9 / 5 | 735,948 |

- The live pairs show no repeatable reduction in steady memory or frame variation, and all runs had zero intervals above 50 ms. Earlier live candidates without those long frames were not reproducible as a baseline difference. Boot work also varies with page timing: candidate reads were higher in both final pairs, so Stage 3 is an ownership and duplicate-work fix, not a demonstrated startup-speed win.
- The stable live memory total is dominated by the GPU process (about 578 MiB) and the game tab (about 105 MiB); Browser and Utility together were about 57 MiB. The desktop shell cannot release the game's textures, geometry or simulation state without the game repository.
- TypeScript and 63 tests / 207 assertions pass; Electron bridge, offline and splash smoke flows pass. The Discord allocation benchmark and clean-code structural checker pass. Stages 1-3 are implemented; Stage 4 measured the shell tradeoff and established that gameplay memory and frame pacing require the owning game source.
- Raw live summaries stay in the ignored `out/final-live/` (`baseline-1.json`, `baseline-2.json`, `candidate-1.json`, `candidate-2.json`); the local WebGL pairs remain under `out/runtime-benchmark-*/report.json`. Copy them out before deleting `out/` if a later comparison needs them.
- Windows packaging was verified offline with the checked-in Electron 44.7.1 distribution: `bunx electron-builder --win --dir -c.electronDist=node_modules/electron/dist -c.win.signAndEditExecutable=false` produced `release/win-unpacked`, `bun run verify:package` passed against its `app.asar` (including `out/boot-watch.js`), and `node out/tools/smoke.js release/win-unpacked/PokeBonk.exe` passed the bridge, offline and loading-screen flows from the packaged executable.
- No new player setting or dependency. Diagnostic policy is established in `SELFTEST_METRICS`, `FRAME_PROBE_DEFAULTS` and `BENCHMARK` before their consumers.
