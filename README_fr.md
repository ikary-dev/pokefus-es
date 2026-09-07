# pokefus-es

Pokefus en espagnol.

**Traduit par : ikary**

## Le passer à quelqu'un d'autre

`node empaquetar.js` prépare dans `dist/pokefus-es` un dossier prêt à être
compressé. On le décompresse à côté de `Pokefus UpLauncher` et on ouvre
`Pokefus en espanol.bat`.

Pas besoin d'installer Node : le .bat utilise l'Electron fourni avec le jeu comme
interpréteur (`ELECTRON_RUN_AS_NODE`). Et l'installation est localisée toute
seule (`src/instalacion.js`), il n'y a aucun chemin écrit en dur.

**Le paquet ne contient ni `backup/` ni `cache/`.** Les backups sont les fichiers
d'origine de CETTE installation ; les restaurer sur un autre ordinateur, avec une
autre version du client, le casserait. Là-bas ils se créent tout seuls la
première fois.

## Utilisation

    node aplicar.js          applique la traduction
    node aplicar.js quitar   remet le client comme il était

Ensuite on lance le jeu normalement. **Il faut relancer `node aplicar.js` après
chaque mise à jour du launcher**, et uniquement pour ça : l'updater connaît le
sha256 de chaque fichier et restaure ceux que l'on modifie dans l'installation.
Tout le reste est traduit à la volée.

## Les trois couches

Le texte du jeu n'est pas à un seul endroit, il est à trois, et chacun demande
une voie différente :

| Où | Ce qu'on voit | Comment c'est traduit |
|---|---|---|
| `loader.swf` (local) | écran de connexion, choix du serveur | le fichier est patché sur le disque |
| `modules/core.swf` (local) | équipe, quêtes, renommée, sac, panoplie, Kolizéum | le fichier est patché sur le disque |
| Fichiers de langue (de `pokefus.org`) | objets, sorts, quêtes, dialogues, vocations | interceptés et servis déjà traduits |
| `clips/pokefus/guide.txt` (local) | le Guide du dresseur en entier | le fichier est remplacé |
| Socket du jeu | tempéraments, talents, lien, chat | proxy TCP qui traduit à la volée |
| HTML d'Electron | panneau latéral, carte, chat | la page est traduite dans chaque fenêtre |

## Pourquoi ça survit aux mises à jour

**Les fichiers de langue** ne voyagent pas dans le client : ils sont téléchargés
à chaque démarrage depuis `pokefus.org`, guidés par un manifeste. Le serveur
publie chaque fichier en français **et** en espagnol avec la même version, ce qui
donne un détecteur de trous exact et gratuit : si une chaîne est identique dans
les deux, c'est que personne ne l'a traduite. Quand Pokefus publiera
`items_es_1181`, l'extracteur le compare à `items_fr_1181` et seul le nouveau
part à la traduction ; le reste sort de la mémoire.

Le client garde ces fichiers dans le stockage Flash et ne les redemande que
lorsque la version monte. C'est pour ça qu'on annonce une **version synthétique**
(la vraie plus le numéro de révision de la mémoire) : en montant la révision, le
client vide son cache tout seul.

**Le texte du serveur** n'est dans aucun fichier : il arrive par TCP. Le client se
connecte à un proxy local (`config.xml` est réécrit au démarrage) qui traduit
chaque message et note ce qu'il ne sait pas traduire. Si le proxy ne démarre pas,
`config.xml` revient à l'original et le jeu se connecte directement.

**La couche HTML** est traduite dans le navigateur, sans réécrire les sources, et
note au passage tout ce qu'elle voit en français et ne sait pas traduire. Quand
Pokefus ajoutera un écran, il apparaîtra tout seul là.

## État

| Couche | Entrées |
|---|---|
| Fichiers de langue (`translations.json`) | 1 563 |
| Interface propre à Pokefus (`modules/core.swf`) | 737 |
| Écran de connexion (`loader.swf`) | 78 |
| Dictionnaire du proxy (`server.json`) | 3 013 |
| Noms appariés par id | 16 132 |
| Couche HTML (`dom.json`) | 32 |
| Guide du dresseur | 17 pages |

Vérifié sur 770 187 messages réels de partie : 0 séparateur, 0 nombre et 0 champ
de données modifiés. Sur les 23 750 fichiers du client, 6 sont modifiés, et
`quitar traduccion` les remet octet pour octet comme ils étaient.

Ce qui reste en français à dessein : les messages de démarrage de `loader.swf`,
qui vivent dans des blocs de bytecode obfusqué, et les rangs d'arène à partir du
deuxième (le code fait `rang + "e"`, et ce `"e"` est aussi le nom d'une variable
du bytecode : le traduire casserait le client).

## Ce qu'il a fallu résoudre

**La table de chaînes est pleine.** Sa longueur est un `uint16` et le générateur
de Dofus la remplit à ras bord : 21 des 198 pools font exactement 65535 o,
justement ceux d'`items` et de `dialog`. Là on laisse le pool intact et on
convertit la référence en un `ActionPush` avec la chaîne littérale
(`estrategia: 'inline'`). Dans `loader.swf`, qui est du code et non des données,
c'est l'inverse (`'pool'`).

**Les décalages sont relatifs.** `Jump`, `If`, `With` et le `codeSize` des
fonctions pointent par distance en octets. Changer la taille d'une action sans
refaire ces nombres donne un SWF valide et un client qui charge indéfiniment.
C'est `src/actions.js` qui s'en occupe.

## Fichiers

    aplicar.js            la seule commande
    src/swf.js            lecture des SWF
    src/actions.js        reconstruit le bytecode en replaçant sauts et fonctions
    src/repack.js         réinjection (deux stratégies)
    src/resolve.js        chaînes empilées par le bytecode : sert à vérifier
    src/lang.js           manifeste et téléchargement avec cache
    src/classify.js       sépare le texte de jeu des identifiants et des données
    src/extract.js        diff ES / FR -> tm/pending.json
    src/extract-dom.js    texte français de la couche HTML
    src/fusionar.js       verse les listes traduites dans la mémoire
    src/server.js         sert les fichiers de langue traduits
    src/patch-local.js    patche les SWF et les textes locaux
    src/proxy.js          proxy TCP qui traduit ce qu'envoie le serveur
    src/server-dic.js     assemble le dictionnaire du proxy
    src/extract-local.js  liste ce qui manque dans les SWF locaux
    src/verify.js         aller-retour sur tout ce qui traîne dans cache/
    hook/                 accroche dans le client et traducteur du DOM
    tm/                   mémoire de traduction
    backup/               originaux intacts

### Vérificateurs

Chacun cherche une classe d'erreur différente, et tous s'exécutent séparément :

    src/comprobar-cliente.js  les 23 750 fichiers contre le manifeste officiel
    src/comprobar.js          rejoue proxy.log : un nombre ou un séparateur a-t-il bougé ?
    src/auditar-proxy.js      idem, champ par champ : seul le texte peut être touché
    src/revisar-claves.js     clés françaises qui n'existent plus dans le jeu
    src/revisar-costuras.js   le texte UNE FOIS RECOLLÉ, là où les fautes se voient
    src/revisar-nombres.js    noms qui ne collent pas avec ceux du jeu lui-même
    src/revisar-numeros.js    chiffres qui dansent entre le français et l'espagnol
    src/revisar-estilo.js     restes de français, ponctuation, calques
    src/pendientes-red.js     ce que le serveur a envoyé et qu'on n'a pas su traduire
    src/trozos-frances.js     quel morceau exact manque, regroupé par forme
    src/riesgo.js             chaînes du SWF qui sont du code et non du texte

## Ajouter des traductions

1. `node src/extract.js` — cherche les nouveaux trous (`tm/pending.json`).
2. Traduire dans `tm/trad-<fichier>.json`, une liste dans le même ordre que
   `tm/por-traducir.json`. Les gros fichiers sont découpés :
   `trad-dialog-a.json`, `-b`, `-c`... Une entrée vide laisse la chaîne
   non traduite.
3. `node src/fusionar.js` — monte la révision, donc le client la récupère seul.

Pour les SWF locaux : `node src/extract-local.js` liste ce qui manque dans
`loader.swf` et `modules/core.swf` ; on traduit directement dans `tm/loader.json`
et `tm/core.json`, qui sont des dictionnaires source -> traduction.

Pour la couche HTML, éditer `tm/dom.json` directement.

Pour le serveur : créer le fichier vide `tm/debug-proxy`, jouer un moment, puis
`node src/pendientes-red.js` (ce qui n'a pas été traduit) et
`node src/trozos-frances.js` (quel morceau exact manque). On traduit dans
`tm/server-manual.json` et on refait le dictionnaire avec
`node src/server-dic.js`. En terminant, supprimer `tm/debug-proxy` et
`proxy.log` : le journal grossit vite.

`trozos-frances.js` regroupe en retirant les chiffres, et c'est ce qui le rend
utile : une fiche de sort change de nombres et devient une autre chaîne, mais le
morceau manquant (`de faiblesse`, `Fait reculer de`) est toujours le même. Une
seule nouvelle entrée peut corriger des milliers de messages.

## Le protocole du serveur

Trois choses qui ont coûté cher à trouver et qu'il vaut mieux ne pas oublier :

**L'adresse du serveur de jeu voyage sous forme de nom d'hôte**, pas d'IP :
`AYKgame.pokefus.org:5555;77`. Chercher seulement de l'IPv4 ne trouvait rien et
le client partait en direct, laissant le proxy sans voir le trafic qui compte. En
plus cette adresse n'est annoncée **qu'une seule fois**, donc les ports de
redirection sont réservés à l'avance : les ouvrir à la lecture du message arrive
trop tard.

**Le texte long voyage encodé en pourcentages.** La description d'un tempérament
arrive sous la forme `%2B10%20%25%20de%20puissance...`, il faut donc décoder
champ par champ, traduire et ré-encoder. Chercher le français dans la chaîne
brute ne trouvait rien.

**Les séparateurs commandent.** Le protocole structure avec `|`, `,`, `;` et `.`.
Une traduction qui glisse l'un d'eux dans un champ en clair coupe le message ;
là, seules les traductions sans séparateur sont appliquées. Dans les champs
encodés il n'y a pas de problème, ils finissent en `%2C`.

La virgule coupe les champs, et le proxy écarte toute traduction dont la valeur
en contient une. Dix entrées écrites avec une virgule ne s'appliquaient donc
jamais -- dont la fiche de tempérament entière. C'est pour ça qu'on les écrit
sans.

Pour voir le protocole brut : créer le fichier `tm/debug-proxy` et lancer le
jeu ; les messages du serveur atterrissent dans `proxy.log`. Le supprimer coupe
l'enregistrement.

## Le client charge le français par-dessus l'espagnol

C'est la cause du fait que la moitié du jeu restait en français quoi qu'on
traduise dans les fichiers ES : le client télécharge les `_es_` **puis les
`_fr_`**, qui les écrasent. Le fichier espagnol contenait « Bandana Mokete » avec
sa description complète, et à l'écran s'affichait « Bandana Troué ».

`src/server.js` sert le contenu espagnol y compris quand le client demande le
français. La version est la même dans les deux langues, seule la lettre change.

## Les noms viennent du jeu lui-même

Le serveur envoie en français le nom de chaque Dofemon, monstre, objet et sort.
La traduction existe déjà dans le fichier espagnol, il n'y a donc pas à l'écrire :
on apparie les deux fichiers **par id**.

Les données sont des enregistrements de même forme dans les deux langues -- un
marqueur de type, l'id, le champ et la valeur :

    "M", #119, "n", "Forgeron Sombre", "g", #1074, ...
    "M", #119, "n", "Herrero Oscuro",  "g", #1074, ...

L'id est identique dans toutes les langues. On repère le marqueur dominant de
chaque fichier (monstres, objets, sorts, PNJ), on indexe id -> nom dans chaque
langue et on croise : **16 132 noms**, et c'est exact — soit l'id est des deux
côtés, soit il n'y a pas de paire. `node src/pares.js` régénère tout après chaque
mise à jour.

On avait d'abord essayé d'aligner les deux séquences jeton par jeton. Abandonné :
sur les gros fichiers elles se désynchronisent et donnaient de fausses paires
comme « Petit Bouftou » face à « Thanos ».

**Noms et phrases passent par des chemins différents** dans le proxy : les noms
vers un index de consultation exacte, les phrases vers une recherche par
sous-chaîne. Les mélanger coûtait 2 ms par message ; séparés, 0,006 ms.

## Crédits

Traduit par : ikary
