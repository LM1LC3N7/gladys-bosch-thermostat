# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## bosch-thermostat-client

<https://github.com/bosch-thermostat/bosch-thermostat-client-python>, by
Pawel Szafer and contributors. Apache License 2.0 (`LICENSE.txt` of the
repository; version 0.28.3 of 2026-09-11, read at commit 384112c). The full
text of the Apache License 2.0 is the `LICENSE` file of this repository; the
project ships no `NOTICE` file.

Ported, rewritten in JavaScript:

- the key derivation and the AES-256-ECB exchange of the KM gateways
  (`encryption/base.py`, `const/ivt.py`): md5(access token + MAGIC) followed
  by md5(MAGIC + password), zero padding, base64. **MAGIC** is the constant
  `867845e97c4e…ad1e4` of the local protocol of the gateways (the same for
  every gateway and every client of it), not an identifier of an
  application; it is used as is, as this notice states;
- the `User-Agent: TeleHeater` header the reference sends to the gateway
  (`const/ivt.py`), the name of the Buderus app's client: Louis accepted it
  for this integration only (2026-11-05, see `TODO.md`);
- the paths read and written, and the setpoint each operation mode writes,
  from its databases `db/db_IVT.json`, `db/rc300_rc200/040802.json`,
  `db/default/011003.json`, `db/can/010701.json` and
  `db/nsc_icom_gateway/040802.json`;
- the test vector of `tests/test_aes.py` (in `test/model.test.js`).

Changes: one value per request read through one connection at a time; the
answers checked (types, units, ranges, bounded lists); setpoints bounded on
our side (room 5 to 30 °C, hot water 65 °C at most); no schedule, no XMPP,
no EasyControl, no Nefit.
