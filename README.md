# gladys-bosch-thermostat

A [Gladys Assistant](https://gladysassistant.com) external integration for
**Buderus (Bosch group) boilers and heat pumps** through their local
**KM50, KM100 or KM200** gateway (and IVT gateways speaking the same
protocol), with the access token printed on the gateway and the password set
in the Buderus app. Local only, no cloud. Unofficial, not affiliated with
Bosch or Buderus.

**Never tested with a real gateway**: Buderus does not document the local
protocol; this integration follows
[bosch-thermostat-client](https://github.com/bosch-thermostat/bosch-thermostat-client-python)
0.28.3 and its controller databases. Newer gateways (MX300/MX400, HomeCom
Easy) use the Bosch cloud: see
[gladys-bosch-homecom](https://github.com/guim31/gladys-bosch-homecom) by
guim31.

User guides: [English](docs/en.md), [français](docs/fr.md).

## How it works

- One Gladys device per gateway (`ext:<selector>:bosch-km:<key>`, the key a
  hash of the uuid of the gateway, never published itself), read every 60 s
  by default, one request per value, one at a time: outdoor and supply
  temperatures, system pressure, and for each heating circuit (hc1-hc4) and
  hot water circuit (dhw1-dhw2) its temperature, setpoint and mode.
- The protocol: AES-256-ECB with a key derived from the access token and the
  password (a constant of the protocol mixed in), zero padding, base64, plain
  http; the `User-Agent: TeleHeater` header of the Buderus app, which the
  gateway expects, accepted by Louis for this integration only (2026-11-05).
- **Modes and setpoints behind one option, off by default**: room setpoints
  in half degrees, 5 to 30 °C; hot water in whole degrees, 20 °C to a
  ceiling of 65 °C by default, 65 °C at most; always within the bounds the
  gateway gives for the setpoint path of the current mode. Decided on a
  fresh read, checked again right before the request leaves, refused unsent
  after 3.5 s, successful only when a read shows the value.
- **An "Off" mode is the protective command**: no option; it cuts a read
  under way and leaves first, cancels the commands not sent yet, goes
  through a pause or refused credentials (one try); kept in `/data` and sent
  again by the reads until the gateway answers it (only answers count: 3 4xx
  refusals at most, 3 answered resends when a read contradicts it). Its
  guard is lifted only by another mode chosen from Gladys or another mode
  read twice after the stop was seen applied. Its three refusal cases are
  listed in the guides.
- **No switch, no writable binary**: a "turn everything off" never reaches
  the boiler (modes are selects).
- **Refused credentials** (answers our key does not open): the reads stop,
  kept in `/data`, never an automatic retry. 429/5xx: a bounded pause kept in
  `/data`. Nothing secret in logs, statuses or `/data`; `/data` never waited
  on for more than 1.5 s.

## Credits

The key derivation, the AES exchange, the paths and the setpoint of each mode
come from
[bosch-thermostat-client](https://github.com/bosch-thermostat/bosch-thermostat-client-python)
(Pawel Szafer and contributors, Apache-2.0, 0.28.3). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Built on the structure of
the sibling integration
[gladys-econet300](https://github.com/LM1LC3N7/gladys-econet300) (local
heating with a protective stop).

## Development

```bash
npm install
npm test                                        # node --test, loopback only
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never leave the machine: the gateway is a fake behind the injected
transport (`test/fixtures/km.js`) or a server on 127.0.0.1 (`test/kit`,
copied from the shared test kit), Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an Apache-2.0 project, credited
with its notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
