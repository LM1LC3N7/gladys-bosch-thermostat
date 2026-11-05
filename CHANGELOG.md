# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: Buderus (Bosch group) boilers and heat pumps through their
  local KM50, KM100 or KM200 gateway (access token and app password): outdoor
  and supply temperatures, system pressure, and for each heating and hot
  water circuit its temperature, setpoint and mode; one Gladys device per
  gateway.
- The modes and the room and hot water setpoints behind one option, off by
  default, within the bounds the gateway gives; room 5 to 30 °C; hot water
  65 °C at most (ceiling 40 to 65 °C, 65 °C by default).
- An "Off" mode of a circuit needs no option and is held by nothing but a
  missing configuration, a mode the circuit does not list or another gateway
  at the address; kept in `/data` and sent again by the reads until the
  gateway answers it.
- Refused credentials stop the reads (no automatic retry); HTTP 429/5xx
  pause them; "Test the connection" button. English and French.
