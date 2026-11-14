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

`bun run smoke` opens a local fixture in the real Electron runtime, checks the preload bridge and writes isolated diagnostics under `out/`. `bun run selftest` diagnoses the live game with an isolated profile. Neither replaces gameplay testing.

Build installers with `bun run dist:win`, `bun run dist:mac` or `bun run dist:linux` on the corresponding platform. The legacy Docker command is an optional npm fallback, uses a separate Node 22 builder and is not part of the verified Bun toolchain.

Automatic updates are disabled in this fork's `client.json`. Enable them only after preparing releases for the configured distribution. Architecture, compatibility, validation and rollback details: [Runtime decision](docs/RUNTIME.md).

Runtime resilience review for 1.5.3: [findings, compatibility and measurements](docs/REVIEW-1.5.3.md). Run `bun run benchmark:state` to reproduce the window persistence burst benchmark.
