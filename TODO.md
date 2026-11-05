# TODO — Buderus KM (gladys-bosch-thermostat) v1

Handoff document: what is done, what was decided, what comes next. Keep it up
to date at the end of every milestone.

## Status

- [x] **Milestone 1 — read, bounded commands, protective stops**
      (2026-11-05): the KM protocol (key from the access token and the app
      password, AES-256-ECB, base64, TeleHeater header), one request at a
      time; one device per gateway (hashed uuid): outdoor and supply
      temperatures, pressure, per heating and hot water circuit its
      temperature, setpoint and mode; modes and setpoints behind
      `allow_commands`; an "off" mode protective with its guard in /data;
      refused key stops the reads, 429/5xx pause, getConfig() retried without
      end; /data bounded to 1.5 s; en/fr, docs, cover. Tested against a fake
      gateway (paths and shapes of the reference's databases, answers sealed
      with its key) and servers on 127.0.0.1, virtual and real clock (x20),
      Node 22 and 24.
- [ ] **Review r1** (xhigh).
- [ ] **Milestone 2 — real gateway**: run against a real KM200 (see "To
      check"); turn its answers (anonymized) into fixtures.

## To check on a real gateway

- Whether the gateway answers without `User-Agent: TeleHeater` (then drop
  it), and what it answers to a PUT it cannot open (400 assumed).
- What a wrong password gives on a GET: a 200 our key does not open
  (assumed, as the reference reads it), or another status.
- Whether a PUT answers 204 (assumed) or 200 with a body, and how fast the
  new value shows in a GET.
- Whether unused circuits listed by `/heatingCircuits` answer
  `operationMode` (then they would show as circuits).
- Whether `currentRoomSetpoint` exists on RC35-type controllers (else the
  setpoint of the mode is read).
- The latency of one request (one value): a scene of four commands fits up
  to 300 ms per request, a command alone up to 800 ms.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-bosch-thermostat:0.1.0`): the first patch release
  gives 0.1.1.
- **Not a duplicate**: lot 18 line (candidats-europe.md), lot 20 wave 1.
  Neighbour: guim31/gladys-bosch-homecom covers the cloud HomeCom gateways
  (MX300/MX400); the KM gateways are local only, no overlap. Said in the
  docs.
- **Reference**: bosch-thermostat-client 0.28.3 (Apache-2.0, Pawel Szafer and
  contributors), read at commit 384112c in
  `~/code/ref/lot20/bosch-thermostat-client` (license checked in its
  `LICENSE.txt`). Ported, not copied; notice in `THIRD_PARTY_NOTICES.md`,
  shipped in the image. The key derivation is checked against its test
  vector (`tests/test_aes.py`).
- **TeleHeater header**: the reference sends `User-Agent: TeleHeater`, the
  client name of the Buderus app, which the KM gateways expect. Imitating an
  application needs Louis's approval: **Louis accepted it for this
  integration only on 2026-11-05** ("J'accepte l'user agent"). Said in the
  docs (fr/en) and in THIRD_PARTY_NOTICES.md.
- **MAGIC**: the constant mixed into the key is part of the local protocol of
  every KM gateway (used by every client), not an identifier of an
  application; used as is, cited in THIRD_PARTY_NOTICES.md.
- **Neighbour structure**: gladys-econet300 (approved at r4: local heating,
  setpoints behind an option, protective stop in /data, one request at a
  time), its Gate, transport, publisher, store and app flow adapted; the
  test kit copied into `test/kit`.
- **Paths**: `/gateway/uuid` (identity), `/gateway/versionFirmware`,
  `/system/sensors/temperatures/outdoor_t1`, `supply_t1`,
  `/heatSources/systemPressure`, `/heatingCircuits`, `/dhwCircuits`, and per
  circuit `operationMode`, `roomtemperature`/`actualTemp`,
  `currentRoomSetpoint`/`currentSetpoint` (else the setpoint of the mode).
  No generic write: only `operationMode` and the setpoint path of the
  current mode (`SETPOINT_PATHS`, from the reference's `mode_to_setpoint`).
- **Identity**: `sha256("bosch-km:" + uuid)`, 16 hex digits. A uuid missing
  = unknown (values not shown, commands refused, a stop still sent); another
  uuid = another gateway (values never on the created device, stops refused).
- **One request at a time** (the Gate), by priority: a stop, a command, the
  polling; a stop cuts the request in flight (a read cut is no failure).
- **Values**: a floatValue in its unit ("C", "bar") and plausible range only
  (-3276.8 / 3276.7 of a sensor not fitted are none); a 4xx or a bad answer
  of one path leaves that value out; a transport failure, a 429/5xx or a key
  refused fails the read.
- **Circuits**: those `/heatingCircuits` and `/dhwCircuits` list (4 and 2 at
  most), kept when their `operationMode` reads.
- **Modes**: a select of the values the circuit lists (letters, digits, _
  and -, 12 at most); labels from a table of the reference's modes, else the
  value; duplicates labelled with their value. The options of a created
  select are kept (the core would mark the device changed).
- **Stops** ("off", "Off", "Always_Off", "heating_off"): one per circuit in
  /data. No option, no bounds, no read; the value must be one the circuit
  lists (created select or last read). Tried again 250 ms when it cannot
  connect, then kept `unsent` and sent first by every next read (periodic
  and follow-up), at a restart and on a new session, without limit; only an
  answer counts: a 4xx answer counts as a refusal (3 at most, only while the
  reads accept our key), a 2xx makes it `sent`, a 429/5xx or no answer keep
  it as it was. Sent while our key is refused: one blind try, kept `unsent`,
  never counted, sent again first with other credentials. `confirmed` when a
  read begun after it shows an off mode; `sent` and another mode read: sent
  again, 3 answered resends at most. Its guard is never lifted by time:
  another mode chosen from Gladys (lifting saved in /data first, put back
  when the mode does not leave), or another mode read twice in a row once
  confirmed.
- **Setpoints while a stop of the same circuit holds**: refused.
- **Commands**: one option for modes and setpoints. Batches gathered for
  50 ms share one fresh read (uuid, the mode of each circuit, the setpoint
  path of that mode); writes leave in order, then each is read back. Sent by
  3.5 s after the click, confirmed by 4.3 s. "Already so" decided on the
  fresh read of the very path written.
- **Bounds**: those the gateway gives with the path written (minValue,
  maxValue, writeable), intersected with ours: room 5-30 °C in half
  degrees, hot water 20 °C to `max_dhw` (65 °C by default, 40-65, never above
  65 °C), checked again in `beforeSend`, with a final 65 °C guard.
- **Refused key**: a ciphertext of the right shape that our key does not
  open into JSON; persisted with 8 bits of a salted scrypt print of address,
  token and password; lifted by other credentials or a successful button.
  An answer that is no ciphertext (another device) is a failure, never a
  refusal.
- **/data**: every read and write bounded to 1.5 s; a stuck or unreadable
  file is never written over and refuses modes and setpoints; a FIFO or other
  special file is refused (opened non-blocking, checked to be a file); the
  session exists before /data is read, a stop clicked meanwhile is kept over
  the file.
- **getConfig()**: retried after 5, 10, 30 s then every minute, without end;
  the SDK's configuration used meanwhile at the start.
- **Polling 60 s by default** (30 to 900 s); the period measured from the
  start of the read before.
- **No energy, schedules, summer/winter, solar, single charge** in v1.
- **Mutation checks** (milestone 1): 38 mutants of the guards (app, client,
  store, transport, parsing), one at a time in a copy of the agent, runner
  `node --test test/*.test.js`: 36 killed (each by a test, no guard
  removed). Two equivalent survivors kept as they are: the check of a stop of
  the circuit in the `beforeSend` of a setpoint (every stop bumps the epoch,
  checked in the same `beforeSend`; a stop held before is refused by the
  check at the start of the batch), and `startedAt > stopSentAt` in
  `observe()` (the write counter set in the same `beforeSend` drops any
  read begun before the stop).
- **Manifest**: `categories: ["climate"]`, `transports: ["local"]`; no
  `keywords` nor `countries` (left out on purpose; would be DE, NL, SE and
  the EU countries where Buderus sells).

## Next

- Summer/winter mode of RC300 heating circuits (`suWiSwitchMode`, "off"
  protective) once checked on a real gateway.
- Single hot water charge (`charge`, bounded in time).
- Energy counters (`/energy`, with the guard of gladys-p1-monitor).
