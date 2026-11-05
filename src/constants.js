// -----------------------------------------------------------------------------
// Constants: the local API of the Buderus / Bosch KM gateways (KM50, KM100,
// KM200, and the IVT gateways speaking the same protocol), feature roles,
// manifest keys, limits and timings.
//
// The gateway answers on the local network in plain http; every body is
// JSON encrypted with AES-256-ECB (zero padding, base64), the key derived
// from the access token printed on the gateway and the password set in the
// Buderus app, with a constant of the protocol (src/km/crypto.js), as
// bosch-thermostat-client 0.28.3 (Apache-2.0) does. Every path answers ONE
// value: { id, type, value, unitOfMeasure, minValue, maxValue, allowedValues,
// writeable } or, for a folder, { type: "refEnum", references: [{ id }] }.
// A write is a PUT of the encrypted { "value": ... } on the same path.
//
// The gateway expects the `User-Agent: TeleHeater` header of the Buderus
// app: Louis accepted it for this integration only (2026-11-05, see TODO.md).
// -----------------------------------------------------------------------------

export const SELECTOR_TYPE = 'bosch-km';

export const USER_AGENT = 'TeleHeater';

export const PATHS = {
  uuid: '/gateway/uuid',
  firmware: '/gateway/versionFirmware',
  outdoor: '/system/sensors/temperatures/outdoor_t1',
  supply: '/system/sensors/temperatures/supply_t1',
  pressure: '/heatSources/systemPressure',
  heatingCircuits: '/heatingCircuits',
  dhwCircuits: '/dhwCircuits',
};

/** The two kinds of circuit, their folder and the shape of their names. */
export const KINDS = {
  hc: { folder: '/heatingCircuits', name: /^hc[1-8]$/, max: 4 },
  dhw: { folder: '/dhwCircuits', name: /^dhw[1-4]$/, max: 2 },
};

/** A circuit name (hc1..hc8, dhw1..dhw4), else undefined. */
export function kindOf(circuit) {
  if (typeof circuit !== 'string') {
    return undefined;
  }
  if (KINDS.hc.name.test(circuit)) {
    return 'hc';
  }
  if (KINDS.dhw.name.test(circuit)) {
    return 'dhw';
  }
  return undefined;
}

/** The fields of a circuit read at every poll (relative to its folder). */
export const CIRCUIT_FIELDS = {
  hc: { temperature: 'roomtemperature', setpoint: 'currentRoomSetpoint', mode: 'operationMode' },
  dhw: { temperature: 'actualTemp', setpoint: 'currentSetpoint', mode: 'operationMode' },
};

/**
 * The setpoint written for each operation mode, as the databases of the
 * reference map them (`mode_to_setpoint`): RC300/RC200/Bosch Condens and
 * iCom (manual, auto), RC35 and alike (day, night, on), the CAN heat pumps
 * (Always_On). A mode not listed (a schedule, off) has no setpoint here:
 * the command is refused.
 */
export const SETPOINT_PATHS = {
  hc: {
    manual: 'manualRoomSetpoint',
    auto: 'temporaryRoomSetpoint',
    day: 'temperatureLevels/day',
    night: 'temperatureLevels/night',
  },
  dhw: {
    high: 'temperatureLevels/high',
    low: 'temperatureLevels/low',
    eco: 'temperatureLevels/eco',
    on: 'temperatureLevels/on',
    Always_On: 'currentSetpoint',
  },
};

/**
 * The "off" values of `operationMode` (reference databases: RC35 "off",
 * RC300 hot water "Off", CAN "Always_Off" and "heating_off"): choosing one
 * is the protective stop of that circuit.
 */
export const OFF_MODES = new Set(['off', 'Off', 'Always_Off', 'heating_off']);

/** A mode value as the gateway lists them: letters, digits, _ and -, 32 at most. */
export const MODE_VALUE = /^[A-Za-z0-9_-]{1,32}$/;

/** Feature roles of the gateway (the last part of their external ids): frozen. */
export const FEATURES = {
  OUTDOOR: 'outdoor-temperature',
  SUPPLY: 'supply-temperature',
  PRESSURE: 'system-pressure',
  STATUS: 'status',
};

/** The roles of a circuit: `<circuit>-<suffix>` (hc1-setpoint, dhw1-mode...): frozen. */
export const CIRCUIT_ROLES = {
  TEMPERATURE: 'temperature',
  SETPOINT: 'setpoint',
  MODE: 'mode',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 30,
  max: 900,
  default: 60,
};

/**
 * Room setpoints, in °C, half degrees: never outside the bounds the gateway
 * gives for the path written (read before each write), nor outside 5 to
 * 30 °C whatever it gives.
 */
export const ROOM = {
  min: 5,
  max: 30,
  step: 0.5,
};

/**
 * Hot water setpoints, in °C, whole degrees: from 20 °C to the configured
 * ceiling (65 °C by default, 40 to 65 °C, never above 65 °C whatever is
 * typed: scalding), and within the bounds the gateway gives (its lower
 * maximum wins).
 */
export const DHW = {
  min: 20,
  max: 65,
  ceilingMin: 40,
  ceilingDefault: 65,
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** An answer is read up to this size, then dropped (one value: a few hundred bytes). */
  responseBytes: 64 * 1024,
  /** References of a folder kept, modes of a circuit kept. */
  references: 16,
  modes: 12,
  /** Names (model, version, mode labels) are cut to this length. */
  nameLength: 60,
  /** Non-protective commands waiting for their turn: more are refused. */
  queue: 4,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of the polling. */
  requestTimeout: 8 * SECOND,
  /** Failed polls: 1, 2, 5, then 10 minutes, never shorter than the interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE],
  /** An HTTP 429 or 5xx: a pause of 1 min to 6 h, persisted in /data. */
  pauseMin: MINUTE,
  pauseMax: 6 * HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads at most this often. */
  testCooldown: 10 * SECOND,
  /** The button waits 30 s in Gladys: it answers by 25 s. */
  testBudget: 25 * SECOND,
  /** getConfig() failed: tried again after 5, 10, 30 s, then every minute, without end. */
  configRetry: [5 * SECOND, 10 * SECOND, 30 * SECOND, MINUTE],
  /** /data: a read or a write never waited for longer (a stuck volume). */
  dataTimeout: 1_500,
  /**
   * Commands (Gladys waits 5 s for the ack, its timer armed when it sends):
   * the request must leave by 3.5 s after the click, or the command is
   * refused unsent; its answer and the read that confirms it are awaited
   * until 4.3 s ("sent, without confirmation" after that).
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** At least 0.3 s left to send after the fresh read. */
  commandMinSend: 300,
  /** Commands arriving within this window share one batch (one fresh read). */
  batchWindow: 50,
  /** A stop that could not connect is tried again within this budget. */
  stopRetryBudget: 250,
  stopRetryStep: 50,
  /** A stop refused by the gateway (4xx) or contradicted by a read is sent again 3 times at most. */
  stopResends: 3,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
};
