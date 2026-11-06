# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors. Read **[TODO.md](./TODO.md) first**: status, decisions already
taken and what comes next.

## What this is

A Gladys Assistant **external integration** for Buderus (Bosch group) boilers
and heat pumps through their local KM50/KM100/KM200 gateway (plain http,
every body passing through AES-256-ECB with a key derived from the access
token printed on the gateway and the password set in the Buderus app): a
Node.js service (Node 22+, ESM, no build step) that runs in its own sandboxed
Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
and the structure of gladys-econet300. Never tested with a real gateway.

## Commands

```bash
npm install
npm test                                  # node --test --test-timeout=60000
node --test test/stop.test.js             # one file
node --test --test-name-pattern "Off"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
memcap npm run mutants                    # test/mutants.json, one at a time in a temporary copy
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only
src/handlers.js                   SDK handlers -> KmApp (shared with the tests)
src/app.js                        lifecycle, getConfig retries, polling, failures, device,
                                  badges, status, commands (batches), the stops and their guards
src/km/crypto.js                  key derivation, AES-256-ECB, zero padding, base64
src/km/client.js                  GET / PUT of one path, opened with the key; the key not enumerable
src/km/gate.js                    one request at a time, by priority; a stop cuts the request in flight
src/km/http.js                    node:http: deadline, size cap, beforeSend, TeleHeater header,
                                  settles once closed
src/km/errors.js                  error codes (KEY: our key does not open the answers)
src/model.js                      the answers checked and reduced (pure): identity, measures,
                                  setpoints, modes, circuits
src/devices.js                    the Gladys device and its states (pure)
src/config.js                     config_schema normalized (address, token, password, ceiling)
src/store.js                      /data: pause, refusal (8-bit print), last read, the stops
src/publisher.js                  states within Gladys' limits
src/constants.js                  paths, setpoint path of each mode, roles, bounds, timings
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: the SDK's fake Gladys, a fake gateway
                                  (test/fixtures/km.js), servers on 127.0.0.1 (test/kit)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever**: device `bosch-km:<16 hex>` (a hash of the
  uuid, never the uuid), features `outdoor-temperature`,
  `supply-temperature`, `system-pressure`, `status`, and per circuit
  `<circuit>-temperature`, `<circuit>-setpoint`, `<circuit>-mode` (the
  circuit named as the gateway names it: hc1..hc8, dhw1..dhw4). A
  republished device never loses a feature (`keepCreatedFeatures`), and a
  created mode select keeps its options.
- Manifest keys (`address`, `token`, `password`, `allow_commands`,
  `max_dhw`, `poll_interval`, `language`, the action `test_connection`) are
  frozen.
- **No switch, no writable binary.** Modes are `text/select` (the values the
  circuit lists); setpoints are `thermostat/target-temperature` (room, half
  degrees) and `water-heater/target-temperature` (hot water, whole degrees).
  Modes and setpoints are behind `allow_commands`, off by default.
- **An "off" mode is protective** (`OFF_MODES`): no option, no bounds, no
  pause, no refusal, no read nor command under way holds it (the Gate cuts
  the request in flight), /data never waited on. Only answers count as
  tries. Its exact refusal cases are listed in the docs: keep `protect()`
  and the docs in sync. Its guard is never lifted by time.
- **Bounds**: always those the gateway gives for the path written (read
  before each write), intersected with ours: room 5 to 30 °C, hot water 20 °C
  to the ceiling (65 °C by default, never above 65 °C).
- **Secrets**: the access token and the password become the AES key of the
  client only (not enumerable); never in a log, a status, an error, `/data`.
  A secret field is "kept by Gladys in its database, never shown again",
  never said to be protected by a cipher.
- **TeleHeater**: the `User-Agent: TeleHeater` header of the Buderus app is
  sent because the gateway expects it; Louis accepted it for this
  integration only (2026-11-05). Do not copy it elsewhere.
- **Clocks**: decisions, pauses, guards and deadlines on the monotonic clock;
  the wall clock only for `/data`. One read of the clock per decision.
- **Failures**: refused key stops the reads (no automatic retry); 429/5xx a
  bounded pause persisted; the periodic read never sooner than the interval
  (restart and test button included; the follow-up reads after a command
  excepted); a value missing (4xx) never blocks the others; getConfig()
  failing is tried again without end.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set once by hand, see `TODO.md`).
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Files** are UTF-8 without BOM (`test/encoding.test.js`); invisible
  characters are written as escapes in the source, never as such.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never leave 127.0.0.1.
