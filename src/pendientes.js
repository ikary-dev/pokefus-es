'use strict';

/*
 * Saca lo que Pokefus dejo sin traducir en sus PROPIOS archivos espanoles.
 *
 * El cliente pide los archivos de idioma en frances y el servidor local le
 * entrega los espanoles. Eso resuelve el juego base, pero no el contenido
 * propio de Pokefus: las lineas nuevas -- los dialogos de la historia, los
 * hechizos y titulos inventados -- estan escritas en frances en los DOS
 * archivos, porque nadie las tradujo al espanol.
 *
 * Por eso el lore salia en frances sin aparecer en ningun informe: no es que
 * fallara la interceptacion, es que el archivo espanol tampoco lo tenia.
 *
 * Detectarlo es directo: si una cadena aparece IGUAL en el archivo frances y en
 * el espanol, y parece frances, es que no se tradujo. Y no hace falta saber que
 * version es ni que trae cada actualizacion: la comparacion es entre los dos
 * archivos de ese momento, asi que sigue valiendo despues de cada parche.
 *
 * La lista sale a tm/pendientes.json agrupada por archivo, lista para
 * traducirse y pasar a tm/translations.json, que es lo que el servidor aplica
 * encima de cada archivo que sirve.
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');
const { CACHE } = require('./lang');

/* Marcas de frances. Con una basta: son cadenas cortas y no da para mas. */
const FRANCES = /[àâçèêëîïôùûœ]|\b(vous|votre|nous|des|une|est|dans|pour|avec|par|mais|donc|cette|aux|qui|que|elle|ses|son|sa|les|le|la|du|de|et|ne|se|au|tu|te|toi|ce|il|on|je|ai|as|pas|plus|tout|rien|jamais|déjà|sur|leur|nos|vos)\b/;

/*
 * Lo que NO es texto de pantalla. En los archivos hay claves internas y
 * anotaciones para el traductor, y traducirlas no arregla nada.
 */
const NO_ES_TEXTO = [
  /^Pnj\(/,            // "Pnj(1121) et Message(6594)" -- una nota interna
  /^\(Ne pas traduire\)/,
  /^[A-Za-z_][A-Za-z0-9_]*$/,
];

function parejas() {
  const grupos = {};

  for (const archivo of fs.readdirSync(CACHE)) {
    const partes = /^([A-Za-z]+)_(es|fr)_(\d+)\.swf$/.exec(archivo);
    if (!partes) continue;

    grupos[partes[1]] = grupos[partes[1]] || {};

    // Se queda la version mas alta: tras una actualizacion estan las dos.
    const previo = grupos[partes[1]][partes[2]];
    const version = Number(partes[3]);

    const versionPrevia = previo ? Number(previo.split('_').pop().replace('.swf', '')) : -1;

    if (version > versionPrevia) {
      grupos[partes[1]][partes[2]] = archivo;
    }
  }

  return grupos;
}

function sinTraducir(nombre, par) {
  const enEspanol = resolvePushedStrings(fs.readFileSync(path.join(CACHE, par.es)), false);
  const enFrances = new Set(
    resolvePushedStrings(fs.readFileSync(path.join(CACHE, par.fr)), false)
      .filter((s) => typeof s === 'string'));

  const salida = [];
  const vistas = new Set();

  for (const cadena of enEspanol) {
    if (typeof cadena !== 'string' || cadena.length < 6 || vistas.has(cadena)) continue;
    if (!enFrances.has(cadena)) continue;           // ya esta traducida
    /*
     * Que la cadena este IGUAL en los dos idiomas ya es la prueba: si fuera
     * texto traducible traducido, no coincidiria. Las marcas de frances solo
     * hacen falta para lo que se parece en los dos idiomas de todas formas --
     * nombres propios, siglas, numeros -- asi que basta con que ademas parezca
     * una frase: que lleve un espacio o termine en punto.
     *
     * Pedir marcas de frances a secas se dejaba fuera "Entendu." y "Alors
     * efface.", que son respuestas de dialogo y salian en pantalla tal cual.
     */
    const pareceFrase = FRANCES.test(cadena) || cadena.indexOf(' ') !== -1 || /[.!?]$/.test(cadena);
    if (!pareceFrase || !/[a-zà-ÿ]{3}/.test(cadena)) continue;
    if (NO_ES_TEXTO.some((patron) => patron.test(cadena))) continue;

    vistas.add(cadena);
    salida.push(cadena);
  }

  return salida;
}

function main() {
  const ruta = path.join(__dirname, '..', 'tm', 'pendientes.json');
  const hecho = fs.existsSync(path.join(__dirname, '..', 'tm', 'translations.json'))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tm', 'translations.json'), 'utf8')).files || {}
    : {};

  const pendientes = {};
  let total = 0;
  let letras = 0;

  for (const [nombre, par] of Object.entries(parejas())) {
    if (!par.es || !par.fr) continue;

    const yaTraducidas = hecho[nombre] || {};
    const faltan = sinTraducir(nombre, par)
      .filter((c) => !Object.prototype.hasOwnProperty.call(yaTraducidas, c));

    if (!faltan.length) continue;

    pendientes[nombre] = faltan;
    total += faltan.length;
    letras += faltan.reduce((suma, c) => suma + c.length, 0);

    console.log(nombre.padEnd(14) + String(faltan.length).padStart(5) + ' cadenas');
  }

  fs.writeFileSync(ruta, JSON.stringify(pendientes, null, 1));
  console.log('\n' + total + ' cadenas (' + Math.round(letras / 1000) + ' mil letras) -> tm/pendientes.json');
}

main();
