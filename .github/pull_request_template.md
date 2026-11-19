## What and why

<!-- One change per PR. What does the operator or supervisor see differently? -->

## Core control

- [ ] Does not touch checkout (`useVerification.ts`, `familyCheckout.ts`, `matching.ts`, `payloads.ts`)
- [ ] Touches checkout, and the rules under "The core control" in AGENTS.md still hold

## Checks

- [ ] `npm run lint`, `npm test`, `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml --lib` pass locally
- [ ] New behavior has a test, or this PR says why it can't (UI, hardware, Tauri runtime)

## Tried on a station

<!-- Delete what does not apply. -->

- [ ] `npm run desktop` on the laptop: <!-- what you did and what you saw -->
- [ ] Installed build on the AIO: <!-- version, what you did -->
- [ ] Not needed: <!-- docs / CI only -->

## Release

- [ ] No release needed
- [ ] Ships in the next version (bump `tauri.conf.json` and `Cargo.toml`, then tag after merge)
