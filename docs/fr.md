# Buderus KM (passerelles KM50, KM100, KM200)

Cette intégration affiche dans Gladys une chaudière ou une pompe à chaleur
**Buderus** (groupe Bosch) par sa passerelle réseau **KM50, KM100 ou KM200**
(et les passerelles IVT qui parlent le même protocole), sur votre réseau
local, sans cloud.

**Jamais testé avec une vraie passerelle** : le protocole local n'est pas
documenté par Buderus ; l'intégration suit bosch-thermostat-client (la
bibliothèque utilisée par l'intégration Bosch de Home Assistant) et ses bases
de régulateurs (RC300, RC200, RC35, CAN, iCom). Sans lien avec Bosch ni
Buderus. Vos retours sont les bienvenus.

Les passerelles récentes (MX300, MX400, appli MyBuderus / HomeCom Easy)
passent par le cloud de Bosch et ne sont pas lues ici : l'intégration
[gladys-bosch-homecom](https://github.com/guim31/gladys-bosch-homecom) de
guim31 s'en charge.

## Ce que vous obtenez

Un appareil Gladys par passerelle, lu toutes les 60 s par défaut :

- températures extérieure et de départ, pression de l'installation ;
- pour chaque **circuit de chauffage** (hc1 à hc4) : température ambiante,
  consigne ambiante, mode (manuel, automatique, jour, nuit... selon le
  régulateur) ;
- pour chaque **circuit d'eau chaude** (dhw1, dhw2) : température de l'eau,
  consigne, mode (Arrêt, Confort, Réduit, Éco, programme...) ;
- état de la liaison (« OK », « Passerelle injoignable », un arrêt depuis
  Gladys en cours...).

Une fonctionnalité apparaît dès que la passerelle donne sa valeur (un circuit
listé mais sans mode, une sonde absente n'en créent pas) et ne disparaît plus
ensuite. Les modes proposés sont ceux que liste le circuit lors de l'ajout de
l'appareil.

## Configuration

1. Trouvez l'adresse de la passerelle sur votre réseau (dans votre box), par
   exemple `192.168.1.50`. Fixez-la (bail DHCP réservé).
2. Relevez le **code d'accès** (« Access token » ou « Login token ») imprimé
   sur l'étiquette de la passerelle, et le **mot de passe** choisi dans
   l'application Buderus (MyDevice, EasyControl) à la mise en service.
3. Dans Gladys, ouvrez la configuration de l'intégration, saisissez
   l'adresse (avec `:port` si ce n'est pas 80), le code d'accès et le mot de
   passe. Un mot de passe sans code d'accès est refusé.
4. Enregistrez, puis ajoutez l'appareil depuis l'onglet **Découverte**.

Le code d'accès et le mot de passe sont gardés par Gladys dans sa base,
jamais réaffichés ; ils ne circulent pas sur le réseau : ils forment la clé
AES des échanges. La passerelle et l'intégration échangent en http simple sur
votre réseau, chaque message passant en AES avec cette clé (le protocole de
la passerelle). Une erreur de l'un ou de l'autre se voit tout de
suite : les réponses ne s'ouvrent pas, l'état le dit et les lectures
s'arrêtent jusqu'à ce que vous les corrigiez.

L'intégration se présente à la passerelle avec l'en-tête
`User-Agent: TeleHeater`, celui de l'application Buderus, que la passerelle
attend (comme bosch-thermostat-client) ; Louis l'a accepté pour cette
intégration seulement, le 2026-11-05.

Le bouton **Tester la connexion** lit la passerelle une fois, mais jamais
plus tôt que l'intervalle de rafraîchissement après la lecture précédente.

## Les commandes

Par défaut, Gladys ne fait que lire. L'option **Autoriser les modes et les
consignes** (désactivée par défaut) permet au tableau de bord, aux scènes et
aux assistants vocaux de :

- changer le **mode** d'un circuit, parmi ceux qu'il liste ;
- changer la **consigne ambiante** d'un circuit de chauffage, par demi-degré,
  entre 5 et 30 °C et dans les bornes que la passerelle donne pour la
  consigne du mode en cours (manuel : consigne manuelle ; automatique :
  consigne temporaire jusqu'au prochain changement du programme ; jour ou
  nuit sur les régulateurs RC35) ;
- changer la **consigne d'eau chaude**, en degrés entiers, celle du mode en
  cours (Confort, Réduit, Éco, Marche), dans les bornes de la passerelle,
  entre 20 °C et le plafond configuré : **65 °C par défaut, de 40 à 65 °C,
  65 °C au plus** quoi qu'on saisisse ou que la passerelle autorise (risque
  de brûlure).

Dans un mode sans consigne propre (un programme, l'arrêt), la consigne est
refusée sans rien envoyer : choisissez d'abord un mode fixe.

Ce ne sont ni des interrupteurs ni des binaires : un « tout éteindre » d'une
scène ou d'un assistant vocal n'atteint pas la chaudière.

Chaque commande relit d'abord la passerelle (son identité, le mode du
circuit, la consigne de ce mode avec ses bornes) et décide sur cette lecture,
jamais sur les valeurs gardées en mémoire ; les commandes arrivées ensemble
(une scène) partagent cette relecture, partent une à une, puis chacune est
relue. Une commande part au plus tard 3,5 s après le clic, sinon elle est
refusée sans rien envoyer. Elle n'est annoncée réussie que si une lecture
faite après elle, avant 4,3 s, montre la valeur demandée ; sinon Gladys
affiche « envoyée et acceptée, pas encore appliquée » (ou « envoyée, sans
confirmation » si la passerelle n'a pas répondu), et les lectures de suivi,
5 s et 20 s plus tard, publient la valeur dès qu'elle apparaît. Au-delà de 4
commandes en attente, elles sont refusées. Un refus HTTP 4xx d'une commande
ne concerne qu'elle : les lectures continuent.

Une consigne est refusée tant qu'un arrêt de son circuit envoyé depuis
Gladys tient (voir ci-dessous) : choisissez d'abord un autre mode. Quand
/data ne peut être lu, modes et consignes sont refusés (un arrêt gardé y
serait inconnu).

## L'arrêt

Choisir un mode **« Arrêt »** (`off`, `Off`, `Always_Off` selon le
régulateur ; surtout l'eau chaude, les circuits de chauffage RC300 n'en
proposent pas) n'a pas besoin de l'option. Il part sans attendre une
lecture, devant toute autre requête : une lecture en cours est interrompue,
les commandes pas encore envoyées sont annulées (rien de ce qui a été demandé
avant l'arrêt ne part après lui). Ni l'option, ni les bornes, ni une pause
demandée par la passerelle (HTTP 429/5xx), ni des identifiants refusés
auparavant (un essai), ni /data illisible ou bloqué, ni un appareil pas
encore lu ne le retiennent.

Il est refusé dans ces trois cas seulement :

- la configuration de l'intégration n'est pas valide, ou n'a pas encore pu
  être lue depuis le démarrage de l'intégration ;
- la valeur n'est pas un mode que le circuit liste (ceux du sélecteur créé,
  ou de la dernière lecture) ;
- la dernière lecture a montré une **autre** passerelle à cette adresse (un
  identifiant différent).

Seule une réponse de la passerelle compte comme un essai. Quand il ne peut
pas partir (passerelle injoignable, coupure), il est retenté pendant 250 ms,
puis gardé dans /data et renvoyé en tête de chaque lecture suivante, sans
limite, jusqu'à ce que la passerelle y réponde : il part donc à la première
lecture qui la joint, et dès le redémarrage de l'intégration ou un
changement de configuration. Parti sans réponse (délai dépassé, coupure) ou
refusé en HTTP 429/5xx, il est renvoyé de même, sans être compté. Il n'est
pas renvoyé à une autre passerelle lue à l'adresse. Quand la passerelle le
refuse en HTTP 4xx alors qu'elle accepte les lectures, il est renvoyé 2 fois
au plus, puis l'état le dit. Cliqué alors que le code d'accès ou le mot de
passe sont refusés, il est envoyé une fois (la passerelle ne peut peut-être
pas le lire), gardé, et renvoyé en tête dès que d'autres identifiants sont
enregistrés ou que le bouton passe.

Il est annoncé réussi quand une lecture partie après lui montre le circuit
en mode arrêt. Une fois vu appliqué, plus rien n'est renvoyé. Si une lecture
partie après lui montre encore un autre mode, il est renvoyé, 3 fois au plus
(seuls les envois qui ont reçu une réponse comptent), puis l'état le dit.

L'arrêt depuis Gladys est gardé dans /data, sans limite de durée. Il est levé
seulement par le choix d'un autre mode depuis Gladys (avec l'option ; la
levée est écrite dans /data avant l'envoi), ou quand, une fois l'arrêt vu
appliqué, un autre mode est lu deux fois de suite (changé sur le régulateur
ou par l'application).

## État et erreurs

- **Code d'accès ou mot de passe refusés** (réponses qui ne s'ouvrent pas
  avec la clé) : les lectures s'arrêtent, sans nouvel essai automatique ;
  enregistrez d'autres identifiants ou utilisez « Tester la connexion ».
- **La passerelle demande de ralentir** (HTTP 429 ou 5xx) : pause de 1 min à
  6 h, gardée dans /data, pour tout sauf l'arrêt.
- **Passerelle injoignable** : nouvel essai après 1, 2, 5 puis 10 min, jamais
  plus tôt que l'intervalle ; l'état de la liaison le dit, et les valeurs de
  plus de deux intervalles ne sont plus republiées.
- **Valeur absente** (HTTP 404 d'un chemin que le régulateur n'a pas) : la
  valeur est laissée de côté, les autres sont lues.
- **Une autre passerelle répond à l'adresse** : ses valeurs ne vont pas sur
  l'appareil créé ; elle apparaît comme un nouvel appareil dans Découverte.

L'identité de l'appareil est une empreinte de l'identifiant (`uuid`, le
numéro de série) de la passerelle ; l'identifiant lui-même n'est ni publié ni
gardé.

## Ce qui est gardé dans /data

`bosch-km-state.json` : une pause en cours, un refus des identifiants (avec
8 bits d'une empreinte salée, de quoi savoir s'ils ont changé, pas de quoi
retrouver un mot de passe), l'heure de la dernière lecture (un redémarrage ne
relit pas plus tôt que l'intervalle), les arrêts envoyés depuis Gladys. Aucun
secret. Une lecture ou une écriture de /data n'est pas attendue plus de
1,5 s : un volume bloqué compte comme illisible et ne retient pas un arrêt.

## Limites connues

- Une requête par valeur : une quinzaine par lecture pour un circuit de
  chauffage et un d'eau chaude. Mesuré sur un faux serveur : une scène de
  quatre commandes (deux modes, deux consignes) est envoyée et confirmée
  jusqu'à 300 ms par requête ; une commande seule jusqu'à 800 ms. Au-delà,
  Gladys affiche « pas encore appliquée » ou « rien envoyé », et les lectures
  de suivi publient la valeur.
- Programmes horaires, mode été/hiver, charge unique d'eau chaude, énergie,
  circuits solaires, passerelles EasyControl et Nefit : pas dans cette
  version.

## Crédits

Le protocole local (clé, AES, chemins, consignes par mode) est porté de
[bosch-thermostat-client](https://github.com/bosch-thermostat/bosch-thermostat-client-python)
(Pawel Szafer et contributeurs, licence Apache 2.0) ; voir
THIRD_PARTY_NOTICES.md.
