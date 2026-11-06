// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature names, operation modes, the
// status of the integration, the answers of the button and the command
// errors. None of them ever carries the address, the access token, the
// password, the key, the uuid or an answer of the gateway.
// -----------------------------------------------------------------------------

import { CIRCUIT_ROLES as R, FEATURES as F } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const deviceName = () => both('Buderus KM gateway', 'Passerelle Buderus KM');

export const FEATURE_NAMES = {
  [F.OUTDOOR]: both('Outdoor temperature', 'Température extérieure'),
  [F.SUPPLY]: both('Supply temperature', 'Température de départ'),
  [F.PRESSURE]: both('System pressure', 'Pression de l’installation'),
  [F.STATUS]: both('Status', 'État de la liaison'),
};

/** "Heating circuit 1", "Hot water 1". */
export function circuitName(circuit) {
  const n = circuit.replace(/^\D+/, '');
  return circuit.startsWith('hc')
    ? both(`Heating circuit ${n}`, `Circuit de chauffage ${n}`)
    : both(`Hot water ${n}`, `Eau chaude ${n}`);
}

const CIRCUIT_FEATURES = {
  hc: {
    [R.TEMPERATURE]: both('room temperature', 'température ambiante'),
    [R.SETPOINT]: both('room setpoint', 'consigne ambiante'),
    [R.MODE]: both('mode', 'mode'),
  },
  dhw: {
    [R.TEMPERATURE]: both('water temperature', 'température de l’eau'),
    [R.SETPOINT]: both('setpoint', 'consigne'),
    [R.MODE]: both('mode', 'mode'),
  },
};

/** "Heating circuit 1 room setpoint". */
export function circuitFeatureName(circuit, kind, role) {
  const c = circuitName(circuit);
  const f = CIRCUIT_FEATURES[kind][role];
  return both(`${c.en} ${f.en}`, `${c.fr} : ${f.fr}`);
}

/** The operation modes the reference databases list; any other is shown as the gateway names it. */
const MODE_NAMES = {
  off: both('Off', 'Arrêt'),
  Off: both('Off', 'Arrêt'),
  Always_Off: both('Off', 'Arrêt'),
  heating_off: both('Heating off', 'Chauffage arrêté'),
  auto: both('Automatic (schedule)', 'Automatique (programme)'),
  Automatic: both('Automatic (schedule)', 'Automatique (programme)'),
  manual: both('Manual', 'Manuel'),
  day: both('Day', 'Jour'),
  night: both('Night', 'Nuit'),
  on: both('On', 'Marche'),
  Always_On: both('On', 'Marche'),
  high: both('High', 'Confort'),
  low: both('Low', 'Réduit'),
  eco: both('Eco', 'Éco'),
  ownprogram: both('Own schedule', 'Programme personnel'),
  comfort: both('Comfort', 'Confort'),
  supersaver: both('Super saver', 'Super économie'),
  normal: both('Normal', 'Normal'),
  exception: both('Exception', 'Exception'),
};

/** The label of a mode value (plain text, never empty). */
export const modeName = (value) =>
  Object.hasOwn(MODE_NAMES, value) ? MODE_NAMES[value] : both(value, value);

export const STATUS_TEXTS = {
  online: both('OK', 'OK'),
  offline: both('Gateway unreachable', 'Passerelle injoignable'),
  foreign: both(
    'Another KM gateway answers at this address',
    'Une autre passerelle KM répond à cette adresse',
  ),
  unknown: both('State not read', 'État non lu'),
  stopUnsent: (circuit) =>
    both(
      `Stop of ${circuitName(circuit).en} from Gladys not sent yet: sent again at each read`,
      `Arrêt de ${circuitName(circuit).fr} depuis Gladys pas encore envoyé : renvoyé à chaque lecture`,
    ),
  stopRefused: (circuit) =>
    both(
      `Stop of ${circuitName(circuit).en} from Gladys refused 3 times by the gateway: not sent again`,
      `Arrêt de ${circuitName(circuit).fr} depuis Gladys refusé 3 fois par la passerelle : plus renvoyé`,
    ),
  stopUnapplied: (circuit) =>
    both(
      `Stop of ${circuitName(circuit).en} from Gladys sent 3 times, not applied`,
      `Arrêt de ${circuitName(circuit).fr} depuis Gladys envoyé 3 fois, non appliqué`,
    ),
  stopPending: (circuit) =>
    both(
      `Stop of ${circuitName(circuit).en} from Gladys sent, not read yet`,
      `Arrêt de ${circuitName(circuit).fr} depuis Gladys envoyé, pas encore relu`,
    ),
  stopped: (circuit) =>
    both(
      `${circuitName(circuit).en} stopped from Gladys`,
      `${circuitName(circuit).fr} arrêté depuis Gladys`,
    ),
  stopWaitsCredentials: both(
    'A stop from Gladys waits: sent as soon as other credentials are saved or the button gets through',
    'Un arrêt depuis Gladys attend : envoyé dès que d’autres identifiants sont enregistrés ou que le bouton passe',
  ),
};

/** Joins notes with "; ". */
export const notes = (list) =>
  both(list.map((n) => n.en).join('; '), list.map((n) => n.fr).join(' ; '));

/** The connection status texts of the configuration screen. */
export const T = {
  connecting: both('Connecting to the gateway...', 'Connexion à la passerelle...'),
  configWait: (wait) =>
    both(
      `Configuration not read from Gladys; next try in ${wait.en}`,
      `Configuration non lue depuis Gladys ; nouvel essai dans ${wait.fr}`,
    ),
  problem: (problem) => PROBLEMS[problem] ?? PROBLEMS.badAddress,
  refused: both(
    'The answers of the gateway cannot be opened with this access token and password: stopped, no automatic retry. Check them, save, or use "Test the connection".',
    'Les réponses de la passerelle ne s’ouvrent pas avec ce code d’accès et ce mot de passe : arrêt, sans nouvel essai automatique. Vérifiez-les, enregistrez, ou utilisez « Tester la connexion ».',
  ),
  busy: (wait) =>
    both(
      `The gateway asks to slow down (HTTP 429/5xx): paused, next read in ${wait.en}`,
      `La passerelle demande de ralentir (HTTP 429/5xx) : pause, prochaine lecture dans ${wait.fr}`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Gateway not read (${reason}); next try in ${wait.en}`,
      `Passerelle non lue (${reason}) ; nouvel essai dans ${wait.fr}`,
    ),
  foreign: both(
    'Another KM gateway answers at this address: its values do not go to the device created; check the address',
    'Une autre passerelle KM répond à cette adresse : ses valeurs ne vont pas sur l’appareil créé ; vérifiez l’adresse',
  ),
  noIdentity: both(
    'The gateway answers without its identifier (uuid): values not shown',
    'La passerelle répond sans son identifiant (uuid) : valeurs non affichées',
  ),
  connected: (firmware) =>
    both(
      `Connected to the gateway${firmware ? ` (firmware ${firmware})` : ''}`,
      `Connecté à la passerelle${firmware ? ` (micrologiciel ${firmware})` : ''}`,
    ),
  nextRead: (wait) => both(`Next read in ${wait.en}`, `Prochaine lecture dans ${wait.fr}`),
  withNote: (text, note) => {
    const bare = (t) => t.replace(/\.$/, '');
    return both(`${bare(text.en)}. ${bare(note.en)}.`, `${bare(text.fr)}. ${bare(note.fr)}.`);
  },
  unreadable: both(
    '/data unreadable: nothing is saved, modes and setpoints are refused (stops still leave).',
    '/data illisible : rien n’est enregistré, modes et consignes sont refusés (les arrêts partent toujours).',
  ),
  test: {
    next: (wait) =>
      both(
        `Read less than an interval ago: next possible in ${wait.en}.`,
        `Lu il y a moins d’un intervalle : prochain essai possible dans ${wait.fr}.`,
      ),
  },
};

const PROBLEMS = {
  noAddress: both(
    'Enter the address of the gateway, its access token and the password, then save.',
    'Saisissez l’adresse de la passerelle, son code d’accès et le mot de passe, puis enregistrez.',
  ),
  https: both(
    'The gateway answers in plain http: enter its address without https://.',
    'La passerelle répond en http simple : saisissez son adresse sans https://.',
  ),
  badAddress: both(
    'Address not valid: an IPv4 address or a host name, with an optional port (192.168.1.50 or 192.168.1.50:8080).',
    'Adresse non valide : une adresse IPv4 ou un nom d’hôte, avec un port facultatif (192.168.1.50 ou 192.168.1.50:8080).',
  ),
  specialAddress: both(
    'This address is a network, broadcast or multicast address: enter the address of the gateway.',
    'Cette adresse est une adresse de réseau, de diffusion ou de multidiffusion : saisissez l’adresse de la passerelle.',
  ),
  noToken: both(
    'Enter the access token printed on the gateway (a password alone is refused).',
    'Saisissez le code d’accès imprimé sur la passerelle (un mot de passe seul est refusé).',
  ),
  badToken: both(
    'Access token not valid: the letters and digits printed on the gateway (dashes allowed).',
    'Code d’accès non valide : les lettres et chiffres imprimés sur la passerelle (tirets acceptés).',
  ),
  noPassword: both(
    'Enter the password set in the Buderus app (MyDevice / EasyControl).',
    'Saisissez le mot de passe défini dans l’application Buderus (MyDevice / EasyControl).',
  ),
  badPassword: both(
    'Password not valid (64 characters at most, no control character).',
    'Mot de passe non valide (64 caractères au plus, sans caractère de contrôle).',
  ),
};

/** The refusals of the commands (the error Gladys shows). */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: both(
    'Commands are off: allow them in the configuration of the integration (an "Off" mode needs no option).',
    'Les commandes sont désactivées : autorisez-les dans la configuration de l’intégration (un mode « Arrêt » n’a pas besoin d’option).',
  ),
  badMode: both(
    'This mode is not one this circuit lists.',
    'Ce mode n’est pas un de ceux que liste ce circuit.',
  ),
  badNumber: both('Not a number.', 'Ce n’est pas un nombre.'),
  badWhole: both('Whole degrees only.', 'Degrés entiers seulement.'),
  badHalf: both('Half degrees only.', 'Demi-degrés seulement.'),
  outOfRange: (low, high) =>
    both(`Out of range: ${low} to ${high} °C.`, `Hors limites : de ${low} à ${high} °C.`),
  noConfig: both(
    'The configuration of the integration is not read or not valid: nothing sent.',
    'La configuration de l’intégration n’est pas lue ou pas valide : rien envoyé.',
  ),
  foreign: both(
    'Another KM gateway answers at this address: nothing sent.',
    'Une autre passerelle KM répond à cette adresse : rien envoyé.',
  ),
  noIdentity: both(
    'The identity of the gateway could not be read: nothing sent.',
    'L’identité de la passerelle n’a pas pu être lue : rien envoyé.',
  ),
  refusedAccount: both(
    'The access token or the password does not open the answers of the gateway: nothing sent.',
    'Le code d’accès ou le mot de passe n’ouvre pas les réponses de la passerelle : rien envoyé.',
  ),
  paused: both(
    'The gateway asked to slow down (HTTP 429/5xx): nothing sent during the pause.',
    'La passerelle a demandé de ralentir (HTTP 429/5xx) : rien envoyé pendant la pause.',
  ),
  queueFull: both(
    'Too many commands waiting: nothing sent.',
    'Trop de commandes en attente : rien envoyé.',
  ),
  stopped: both(
    'A stop was sent since: this command was not sent.',
    'Un arrêt a été envoyé depuis : cette commande n’a pas été envoyée.',
  ),
  stopHolds: both(
    'This circuit was stopped from Gladys: choose another mode first (nothing sent).',
    'Ce circuit a été arrêté depuis Gladys : choisissez d’abord un autre mode (rien envoyé).',
  ),
  unreadableData: both(
    '/data cannot be read or written: nothing sent.',
    '/data ne peut être lu ou écrit : rien envoyé.',
  ),
  queueLate: both(
    'Not sent in time, the commands before it took the time: nothing sent.',
    'Pas partie à temps, les commandes avant elle ont pris le temps : rien envoyé.',
  ),
  tooSlow: both(
    'The gateway did not answer in time: nothing sent.',
    'La passerelle n’a pas répondu à temps : rien envoyé.',
  ),
  notRead: (reason) =>
    both(
      `The gateway could not be read (${reason}): nothing sent.`,
      `La passerelle n’a pas pu être lue (${reason}) : rien envoyé.`,
    ),
  missingValue: both(
    'The gateway does not give this value: nothing sent.',
    'La passerelle ne donne pas cette valeur : rien envoyé.',
  ),
  noSetpointForMode: both(
    'In its current mode (schedule or off) this circuit has no setpoint to change: nothing sent.',
    'Dans son mode actuel (programme ou arrêt), ce circuit n’a pas de consigne à changer : rien envoyé.',
  ),
  notWritable: both(
    'The gateway says this value is read only: nothing sent.',
    'La passerelle indique que cette valeur est en lecture seule : rien envoyé.',
  ),
  notSent: (reason) => both(`Not sent (${reason}).`, `Rien envoyé (${reason}).`),
  rejected: (result) =>
    both(
      `The gateway refused the command (${result}).`,
      `La passerelle a refusé la commande (${result}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Sent, without confirmation (${reason}): checked by the next reads.`,
      `Envoyée, sans confirmation (${reason}) : vérifiée par les prochaines lectures.`,
    ),
  notYetApplied: both(
    'Sent and accepted, not applied yet: checked by the next reads.',
    'Envoyée et acceptée, pas encore appliquée : vérifiée par les prochaines lectures.',
  ),
  stopUnsent: (reason) =>
    both(
      `Stop not sent (${reason}): sent again at each read until it leaves.`,
      `Arrêt non envoyé (${reason}) : renvoyé à chaque lecture jusqu’à ce qu’il parte.`,
    ),
  stopAfterCredentials: (reason) =>
    both(
      `Stop sent with credentials the gateway refused (${reason}): sent again once other credentials are saved or the button gets through.`,
      `Arrêt envoyé avec des identifiants que la passerelle refuse (${reason}) : renvoyé dès que d’autres identifiants sont enregistrés ou que le bouton passe.`,
    ),
  stopRejected: (reason) =>
    both(
      `Stop refused by the gateway (${reason}): sent again by the next reads (twice at most).`,
      `Arrêt refusé par la passerelle (${reason}) : renvoyé par les prochaines lectures (2 fois au plus).`,
    ),
  stopUnconfirmed: (reason) =>
    both(
      `Stop sent, without confirmation (${reason}): checked by the next reads.`,
      `Arrêt envoyé, sans confirmation (${reason}) : vérifié par les prochaines lectures.`,
    ),
  stopNotYet: both(
    'Stop sent and accepted; the gateway has not shown it yet: checked by the next reads.',
    'Arrêt envoyé et accepté ; la passerelle ne l’indique pas encore : vérifié par les prochaines lectures.',
  ),
};
