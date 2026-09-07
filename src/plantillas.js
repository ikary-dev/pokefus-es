'use strict';

/*
 * Saca las frases de los efectos de combate, que llegan ya rellenadas.
 *
 * El cliente guarda plantillas con huecos:
 *
 *     fr: "Dommages : #1{~1~2 à }#2% de la vie de l'attaquant (eau)"
 *     es: "Daños: #1{~1~2 a }#2% de la vida del atacante (agua)"
 *
 * Pero el servidor no manda la plantilla: manda el resultado -- "Dommages : 10
 * à 17" -- de modo que emparejar plantillas enteras no sirve de nada, no hay
 * con que compararlas.
 *
 * Lo que si sirve son sus TROZOS LITERALES: lo que queda al quitar los huecos.
 * "Dommages : " y "% de la vie de l'attaquant (eau)" aparecen tal cual en el
 * texto que llega, y su traduccion esta en la plantilla espanola, en la misma
 * posicion. Se emparejan uno a uno.
 *
 * Solo se aceptan los pares cuyas dos plantillas tienen el mismo numero de
 * trozos: si no coinciden, la estructura es distinta y emparejar por posicion
 * seria inventar.
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');
const { CACHE } = require('./lang');

const esNumero = (token) => typeof token === 'string' && token.charCodeAt(0) === 35;
const esMarcador = (token) => typeof token === 'string' && token.length <= 2 && !esNumero(token);

/* Los huecos de la plantilla: #1, ~2, y las llaves de los tramos opcionales. */
const HUECOS = /#\d+|~\d+|[{}]/;

function indexar(tokens) {
  const indice = new Map();

  for (let i = 0; i + 3 < tokens.length; i++) {
    if (!esMarcador(tokens[i]) || !esNumero(tokens[i + 1]) || !esMarcador(tokens[i + 2])) continue;

    const valor = tokens[i + 3];
    if (typeof valor !== 'string' || esNumero(valor) || !HUECOS.test(valor)) continue;

    indice.set(tokens[i] + tokens[i + 1] + tokens[i + 2], valor);
  }

  return indice;
}

function versionEnCache(nombre, idioma) {
  const patron = new RegExp('^' + nombre + '_' + idioma + '_\\d+\\.swf$');
  return fs.readdirSync(CACHE).find((archivo) => patron.test(archivo));
}

function archivosConPar() {
  const nombres = new Set();

  for (const archivo of fs.readdirSync(CACHE)) {
    const partes = /^([A-Za-z]+)_(?:es|fr)_\d+\.swf$/.exec(archivo);
    if (partes) nombres.add(partes[1]);
  }

  return [...nombres].filter((n) => versionEnCache(n, 'fr') && versionEnCache(n, 'es')).sort();
}

/* Un trozo solo vale si tiene letras y no es un simple signo de puntuacion. */
const UTIL = /[A-Za-zÀ-ÿ]{2}/;

function main() {
  const trozos = {};
  const ambiguos = new Set();
  let plantillas = 0;

  for (const nombre of archivosConPar()) {
    const fr = indexar(resolvePushedStrings(fs.readFileSync(path.join(CACHE, versionEnCache(nombre, 'fr'))), true));
    if (!fr.size) continue;

    const es = indexar(resolvePushedStrings(fs.readFileSync(path.join(CACHE, versionEnCache(nombre, 'es'))), true));
    let encontrados = 0;

    for (const [clave, frances] of fr) {
      const espanol = es.get(clave);
      if (!espanol || espanol === frances) continue;

      const enFrances = frances.split(HUECOS);
      const enEspanol = espanol.split(HUECOS);
      if (enFrances.length !== enEspanol.length) continue;

      plantillas++;

      for (let i = 0; i < enFrances.length; i++) {
        const a = enFrances[i];
        const b = enEspanol[i];
        if (a === b || !UTIL.test(a) || !b) continue;

        if (trozos[a] && trozos[a] !== b) { ambiguos.add(a); continue; }
        if (!trozos[a]) encontrados++;
        trozos[a] = b;
      }
    }

    if (encontrados) console.log(nombre.padEnd(14) + String(encontrados).padStart(5) + ' trozos');
  }

  for (const a of ambiguos) delete trozos[a];

  const salida = path.join(__dirname, '..', 'tm', 'plantillas-fr-es.json');
  fs.writeFileSync(salida, JSON.stringify(trozos, null, 1));
  console.log('\n' + plantillas + ' plantillas emparejadas -> ' + Object.keys(trozos).length +
    ' trozos (' + ambiguos.size + ' descartados) -> tm/plantillas-fr-es.json');
}

main();
