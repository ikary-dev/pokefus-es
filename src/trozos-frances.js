'use strict';

/*
 * Dice QUE trozo de frances queda, no que frase lo tiene.
 *
 * Las fichas de hechizo y de objeto llegan como un registro con numeros y texto
 * mezclados:
 *
 *   542.5.110.Métamourphose.-1|Change l'apparence 17|Multiplie les dommages par 3
 *
 * Traducirlas una a una no sirve: cambia un numero y ya es otra cadena distinta.
 * Lo que se repite es el trozo SIN los numeros -- "Change l'apparence",
 * "Multiplie les dommages par" -- y eso es lo que hay que meter en el
 * diccionario, porque el proxy sustituye por dentro del campo.
 *
 * Asi que se traduce lo que ya sabemos, se mira lo que queda en frances en el
 * RESULTADO, y se agrupa cambiando los numeros por #. Lo que salga arriba de la
 * lista arregla miles de mensajes de golpe.
 *
 *   node src/trozos-frances.js [cuantos]
 */

const fs = require('fs');
const path = require('path');
const { crearTraductor } = require('./proxy');

const RAIZ = path.join(__dirname, '..');
const leer = (a) => JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', a), 'utf8'));

function leerNombres() {
  const nombres = Object.assign({}, leer('nombres-fr-es.json'), leer('nombres-manual.json'));
  const traducciones = leer('translations.json').files || {};
  for (const grupo of ['npc', 'monsters', 'items', 'maps', 'titles']) {
    Object.assign(nombres, traducciones[grupo] || {});
  }
  return nombres;
}

/*
 * Palabras que solo existen en frances.
 *
 * La primera version incluia "de", "la", "un", "que", "son", "fin", "entre"...
 * que en espanol son igual de corrientes, y entonces marcaba como francesa casi
 * cualquier linea ya traducida: mil avisos buenos escondidos entre diez mil
 * falsos. Aqui solo hay palabras que en espanol no existen.
 */
const PALABRA_FRANCESA = new RegExp('(^|[^A-Za-zÀ-ÿ])(' + [
  'des', 'du', 'le', 'les', 'une', 'et', 'ou', 'est', 'sont', 'dans', 'pour',
  'avec', 'sans', 'sous', 'moins', 'qui', 'ne', 'pas', 'sa', 'ses', 'elle',
  'ils', 'vous', 'votre', 'tous', 'toutes', 'chaque', 'aux', 'au', 'ce',
  'cette', 'leur', 'niveau', 'niveaux', 'dommages', 'sorts', 'cases', 'tours',
  'agilité', 'intelligence', 'sagesse', 'vitalité', 'gagné', 'gagnés',
  'perdus', 'perdu', 'retrait', 'soin', 'soins', 'apparence', 'faiblesse',
  'malus', 'effet', 'effets', 'reculer', 'avancer', 'change', 'multiplie',
  'renvoie', 'invoque', 'vole', 'inflige', 'ordinaire', 'solide', 'misérable',
  'constitution', 'endurance', 'frappe', 'initiative', 'début', 'combat',
  'équipe', 'créature', 'créatures', 'bête', 'bêtes', 'neutre', 'réduit',
  'réduits', 'toujours', 'jamais', 'aucune', 'aucun', 'depuis', 'chez',
  'ainsi', 'dont', 'alors', 'donc', 'encore', 'rien', 'autre', 'vers',
  'puis', 'jusqu', 'très', 'aussi', 'même', 'quand', 'contre', 'joueur',
  'joueurs', 'ennemi', 'ennemis', 'lanceur', 'cible', 'cibles', 'portée',
  'invocation', 'invocations', 'esquive', 'puissance', 'dégâts', 'soigné',
].join('|') + ')(?=[^A-Za-zÀ-ÿ]|$)', 'i');

/*
 * La lista de palabras nunca esta completa: "Voici 15 Capsules Simples :
 * celles-ci s'ouvrent partout." se colo entera porque no llevaba ninguna.
 *
 * Esto no depende del vocabulario: el espanol no eliso nunca con apostrofo. Un
 * "l'", "d'", "qu'" o "c'est" es frances con total seguridad, y aparece en casi
 * cualquier frase francesa de largo normal.
 */
const ELISION_FRANCESA = /\b(l|d|qu|n|s|c|j|m|t|jusqu|lorsqu|puisqu)'[a-zà-ÿ]/i;

/* Se corta el texto en trozos por los separadores del protocolo. */
const SEPARADORES = /[|;~,.](?=[^0-9])|(?<=[^0-9])[|;~,.]/;

function trozosDe(texto) {
  return texto.split(/[|~;]/)
    .flatMap((t) => t.split(/(?<=[a-zà-ÿ)%])\.(?=[A-Z0-9-])/))
    .map((t) => t.trim())
    .filter(Boolean);
}

/* Los numeros son lo que cambia entre una ficha y la siguiente. */
const conNumerosFuera = (t) => t.replace(/-?\d+([.,]\d+)?/g, '#');

function main() {
  const cuantos = Number(process.argv[2]) || 60;
  const registro = path.join(RAIZ, 'proxy.log');

  if (!fs.existsSync(registro)) { console.log('No hay proxy.log.'); return; }

  /*
   * Con Set y no con lista: la misma ficha pasa miles de veces por la red y
   * volver a traducirla cada vez tardaba mas de diez minutos.
   */
  const sospechosos = new Map();

  const apuntar = function (campo) {
    const texto = campo.indexOf('A MEDIAS: ') === 0 ? campo.slice(10) : campo;
    sospechosos.set(texto, (sospechosos.get(texto) || 0) + 1);
  };

  const traducir = crearTraductor(
    () => ({ frases: leer('server.json'), nombres: leerNombres() }), apuntar);

  for (const linea of fs.readFileSync(registro, 'utf8').split('\n')) {
    if (!linea) continue;
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch (error) { continue; }
    traducir(mensaje);
  }

  /*
   * Se vuelve a traducir cada sospechoso por separado y se miran los trozos del
   * RESULTADO: los que sigan teniendo palabras francesas son los que faltan.
   */
  const cuenta = new Map();
  const ejemplo = new Map();

  for (const [original, veces] of sospechosos) {
    for (const trozo of trozosDe(traducir(original))) {
      if (trozo.length < 4) continue;
      if (!PALABRA_FRANCESA.test(trozo) && !ELISION_FRANCESA.test(trozo)) continue;

      const forma = conNumerosFuera(trozo);
      cuenta.set(forma, (cuenta.get(forma) || 0) + veces);
      if (!ejemplo.has(forma)) ejemplo.set(forma, trozo);
    }
  }

  const filas = [...cuenta.entries()].sort((a, b) => b[1] - a[1]);

  console.log(sospechosos.size + ' campos distintos con frances, ' + filas.length + ' trozos distintos\n');

  for (const [forma, veces] of filas.slice(0, cuantos)) {
    console.log('  x' + String(veces).padEnd(6) + JSON.stringify(ejemplo.get(forma)).slice(0, 120));
  }
}

main();
