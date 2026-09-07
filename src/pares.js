'use strict';

/*
 * Saca el diccionario frances -> espanol de los propios archivos del juego.
 *
 * El servidor manda en frances los nombres y los textos de efectos, y todo eso
 * ya esta traducido en el archivo espanol. No hay que escribirlo: hay que
 * emparejarlo. Y se empareja POR ID, que es lo unico exacto.
 *
 * Los datos son registros con la misma forma en los dos idiomas -- un marcador
 * de tipo, el id, el campo y el valor:
 *
 *     "M", #119, "n", "Forgeron Sombre", "g", #1074, ...
 *     "M", #119, "n", "Herrero Oscuro",  "g", #1074, ...
 *
 * El id es identico en todos los idiomas, asi que se indexa id -> texto en cada
 * uno y se cruzan. O el id esta en los dos lados o no hay pareja.
 *
 * SE RECOGEN TODOS LOS CAMPOS, no solo el del nombre: un registro tambien lleva
 * la descripcion del objeto, el texto del efecto o el resumen del hechizo, y
 * todo eso sale en pantalla igual.
 *
 * Antes se intento alinear las dos secuencias token a token. Se descarto: en los
 * archivos grandes se desincronizan y salian parejas falsas como "Petit Bouftou"
 * contra "Thanos". Una pareja de menos no cuesta nada; una falsa cambia una
 * palabra por otra que no tiene nada que ver.
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');
const { classify } = require('./classify');
const { CACHE } = require('./lang');

const esNumero = (token) => typeof token === 'string' && token.charCodeAt(0) === 35;
const esMarcador = (token) => typeof token === 'string' && token.length <= 2 && !esNumero(token);

/* Por debajo de esto no es un campo, es una coincidencia. */
const MINIMO_APARICIONES = 20;

function patrones(tokens) {
  const cuenta = new Map();

  for (let i = 0; i + 3 < tokens.length; i++) {
    if (!esMarcador(tokens[i]) || !esNumero(tokens[i + 1])) continue;
    if (!esMarcador(tokens[i + 2]) || typeof tokens[i + 3] !== 'string' || esNumero(tokens[i + 3])) continue;

    const clave = tokens[i] + ' ' + tokens[i + 2];
    cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
  }

  return [...cuenta.entries()]
    .filter((entrada) => entrada[1] >= MINIMO_APARICIONES)
    .sort((a, b) => b[1] - a[1])
    .map((entrada) => entrada[0]);
}

function indexar(tokens, clave) {
  const [marcador, campo] = clave.split(' ');
  const indice = new Map();

  for (let i = 0; i + 3 < tokens.length; i++) {
    if (tokens[i] !== marcador || !esNumero(tokens[i + 1]) || tokens[i + 2] !== campo) continue;
    if (typeof tokens[i + 3] !== 'string' || esNumero(tokens[i + 3])) continue;
    indice.set(tokens[i + 1], tokens[i + 3]);
  }

  return indice;
}

/*
 * Segunda forma de registro, para los archivos que no siguen la primera.
 *
 * En hints -- los sitios del mapa -- el campo no viene detras de un marcador
 * sino de dos numeros: "#1384, #4, n, Donjon des Scarafeuilles". Esos dos
 * numeros (el mapa y la categoria) identifican el registro igual de bien que un
 * id, y son iguales en los dos idiomas, asi que sirven de clave.
 */
function indexarPorContextoNumerico(tokens) {
  const indice = new Map();

  for (let i = 2; i + 1 < tokens.length; i++) {
    if (!esMarcador(tokens[i]) || !esNumero(tokens[i - 1]) || !esNumero(tokens[i - 2])) continue;

    const valor = tokens[i + 1];
    if (typeof valor !== 'string' || esNumero(valor) || valor.length < 4) continue;

    indice.set(tokens[i - 2] + '/' + tokens[i - 1] + '/' + tokens[i], valor);
  }

  return indice;
}

function versionEnCache(nombre, idioma) {
  const patron = new RegExp('^' + nombre + '_' + idioma + '_\\d+\\.swf$');
  /*
   * La MAS NUEVA, no la primera del listado. Tras una actualizacion conviven en
   * cache la version vieja y la nueva, y quedarse con la vieja significa sacar
   * el diccionario del juego de la semana pasada.
   */
  const version = (archivo) => Number(archivo.split('_').pop().replace('.swf', ''));

  return fs.readdirSync(CACHE)
    .filter((archivo) => patron.test(archivo))
    .sort((a, b) => version(a) - version(b))
    .pop();
}

function archivosConPar() {
  const nombres = new Set();

  for (const archivo of fs.readdirSync(CACHE)) {
    const partes = /^([A-Za-z]+)_(?:es|fr)_\d+\.swf$/.exec(archivo);
    if (partes) nombres.add(partes[1]);
  }

  return [...nombres].filter((n) => versionEnCache(n, 'fr') && versionEnCache(n, 'es')).sort();
}

function main() {
  const pares = {};

  for (const nombre of archivosConPar()) {
    const fr = resolvePushedStrings(fs.readFileSync(path.join(CACHE, versionEnCache(nombre, 'fr'))), true);
    const es = resolvePushedStrings(fs.readFileSync(path.join(CACHE, versionEnCache(nombre, 'es'))), true);

    // Aunque no haya patron del primer tipo se sigue: la segunda forma -- la
    // del contexto numerico -- puede tenerlos igual, y era el caso de hints,
    // que se saltaba entero y dejaba los sitios del mapa en frances.
    const claves = patrones(fr);

    let encontrados = 0;

    // Las dos formas de registro: la del marcador con id y la del contexto numerico.
    const indices = claves.map(function (clave) {
      return [indexar(fr, clave), indexar(es, clave)];
    });
    indices.push([indexarPorContextoNumerico(fr), indexarPorContextoNumerico(es)]);

    for (const [enFrances, enEspanol] of indices) {
      for (const [id, frances] of enFrances) {
        const espanol = enEspanol.get(id);
        if (!espanol || espanol === frances) continue;
        if (frances.length < 4) continue;
        if (classify(frances) !== 'prose' || classify(espanol) !== 'prose') continue;

        /*
         * Una traduccion no cambia las cifras. Si los numeros no coinciden, la
         * pareja esta mal: los ids se desalinearon en ese archivo y se han
         * cruzado dos registros distintos.
         *
         * Salio con "Kilimanj'haro le Grimpeur", emparejado contra "Kilibrill
         * vol.2 el Vengativo". El "2" que aparecia de la nada se colaba en un
         * campo de datos del servidor y corria toda la cuenta de numeros del
         * mensaje.
         */
        const cifras = (texto) => (texto.match(/[0-9]+/g) || []).join(',');
        if (cifras(frances) !== cifras(espanol)) continue;

        // Una traduccion no cambia de tamano radicalmente.
        const proporcion = espanol.length / frances.length;
        if (proporcion < 0.4 || proporcion > 2.5) continue;

        /*
         * Que dos archivos traduzcan lo mismo de forma algo distinta -- uno
         * dice "Mazmorra de los Escarahojas" y otro "de las" -- no es un
         * conflicto: las dos son correctas en su sitio. Se queda la primera.
         *
         * Descartar ambas era lo que hacia el codigo anterior, y perdia nombres
         * buenos. Tenia sentido cuando las parejas salian de alinear secuencias
         * y una discrepancia delataba un desajuste; emparejando por id, no.
         */
        if (pares[frances]) continue;
        encontrados++;
        pares[frances] = espanol;
      }
    }

    console.log(nombre.padEnd(16) + String(encontrados).padStart(6) + ' textos  (' +
      claves.length + ' campo' + (claves.length === 1 ? '' : 's') + ': ' +
      claves.map((c) => c.replace(' ', ',')).join(' ') + ')');
  }

  const salida = path.join(__dirname, '..', 'tm', 'nombres-fr-es.json');
  fs.writeFileSync(salida, JSON.stringify(pares, null, 1));
  console.log('\n' + Object.keys(pares).length + ' textos -> tm/nombres-fr-es.json');
}

main();
