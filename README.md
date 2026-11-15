# PokéBonk · app de escritorio

Fork del cliente de escritorio de **[PokéBonk](https://pokebonk.com)** para Windows, macOS y Linux (también Steam Deck).

Descárgala desde la sección **App** del menú del juego o desde [Releases](../../releases/latest).

- La app carga el juego de pokebonk.com: tu cuenta y tu progreso son los mismos que en la web.
- Es gratis. Este repositorio es un fork; consulta pokebonk.com para las descargas oficiales.
- Windows puede avisar con «Windows protegió su PC»: pulsa «Más información» y «Ejecutar de todas formas» (la app aún no está firmada).

PokéBonk es un fan-game no oficial, gratuito y sin ánimo de lucro. Pokémon es de Nintendo, Creatures y GAME FREAK.

## Development

Use Bun 1.4.4 and Node.js 26.13.1. Electron 44.7.1 supplies the installed application's Chromium and embedded Node.js runtime; Bun manages dependencies, scripts and tests.

```sh
bun install --frozen-lockfile
bun run verify
bun run smoke
bun start
```

`bun run smoke` opens local fixtures in the real Electron runtime, checks the preload bridge and writes isolated diagnostics under `out/`; `node out/tools/smoke.js <path-to-executable>` runs the same flows against a packaged build, which is what the `Release` workflow checks on macOS. `bun run selftest` diagnoses the live game with an isolated profile and always ends: `--selftest-deadline=<ms>` (120 s by default) writes a report with `loaded: false` and exits non-zero when the page never finishes loading. Neither replaces gameplay testing.

### Layout

Flat by design: one level of source folders, everything else at the root.

```
src/          main.ts, preload.ts, discord.ts, text.ts, updater.ts and the flat
              modules they import (config, navigation, distribution, window-state,
              bridge, settings, coalesced-task, discord-frames)
src/pages/    loading screen and offline page scripts (own tsconfig, out/pages)
src/tools/    dev and release tools (smoke, check-*, benchmark, sync) plus the
              PowerShell capture helper (out/tools, never packaged)
static/       HTML pages, fonts and splash art loaded as-is
build/        icon.ico (Windows) and icon.png (window, macOS, Linux)
tests/        bun test suites
docs/         runtime and distribution notes
out/          build output (ignored)   release/  installers (ignored)
```

`bun run build` compiles `src/` and `src/pages/`; `electron-builder.yml` ships `out/*.js`, `out/pages/`, `static/`, `build/icon.png`, `package.json` and `client.json`. The Windows `.exe`, the installer and the shortcuts take `build/icon.ico`.

Build installers with `bun run dist:win`, `bun run dist:mac` or `bun run dist:linux` on the corresponding platform. The legacy Docker command is an optional npm fallback, uses a separate Node 22 builder and is not part of the verified Bun toolchain.

Automatic updates are disabled in this fork's `client.json`. Enable them only after preparing releases for the configured distribution. Architecture, compatibility, validation and rollback details: [Runtime decision](docs/RUNTIME.md).
