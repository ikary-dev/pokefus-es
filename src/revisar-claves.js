'use strict';

/*
 * Comprueba que cada clave francesa exista de verdad en el archivo del juego.
 *
 * Una traduccion se aplica buscando su clave -- el texto frances -- dentro del
 * SWF. Si la clave no cuadra ni por un caracter, la entrada no sirve para nada
 * y no hay ningun aviso: el texto sale en frances y el diccionario parece
 * completo.
 *
 * Aqui costo siete entradas. Al unificar nombres hice reemplazos sobre el
 * archivo JSON entero ("Anselme Fourre" -> "Anselmo Fourre") y el cambio entro
 * tambien en el lado frances, que es justo el que no se puede tocar. Las
 * misiones volvieron al frances sin que nada lo dijera.
 *
 *   node src/revisar-claves.js
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');

const RAIZ = path.join(__dirname, '..');

function ultimoArchivo(prefijo) {
  const cache = path.join(RAIZ, 'cache');
  if (!fs.existsSync(cache)) return null;

  return fs.readdirSync(cache)
    .filter((f) => f.indexOf(prefijo) === 0)
    .sort((a, b) => Number(a.split('_').pop().replace('.swf', '')) -
      Number(b.split('_').pop().replace('.swf', '')))
    .pop();
}

function main() {
  const traducciones = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'tm', 'translations.json'), 'utf8')).files || {};

  let huerfanas = 0;

  /*
   * El cliente tambien: core.json y loader.json se aplican sobre los SWF de la
   * instalacion, y sus claves se estropearon por el mismo motivo.
   */
  for (const [dic, swf] of [['core.json', 'backup/modules/core.swf'], ['loader.json', 'backup/loader.swf']]) {
    const ruta = path.join(RAIZ, swf);
    if (!fs.existsSync(ruta)) continue;

    const tabla = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', dic), 'utf8'));
    const dentro = new Set(
      resolvePushedStrings(fs.readFileSync(ruta), false).filter((x) => typeof x === 'string'));

    const sueltas = Object.keys(tabla).filter((clave) => !dentro.has(clave));

    console.log(dic.padEnd(14) + Object.keys(tabla).length + ' entradas, ' +
      (sueltas.length ? sueltas.length + ' SIN CORRESPONDENCIA' : 'todas cuadran'));

    for (const clave of sueltas.slice(0, 6)) console.log('     ' + JSON.stringify(clave).slice(0, 100));
    huerfanas += sueltas.length;
  }

  for (const [archivo, tabla] of Object.entries(traducciones)) {
    const claves = Object.keys(tabla);
    if (!claves.length) continue;

    /*
     * Se mira el archivo ESPANOL, que es sobre el que se aplica el parche. La
     * clave puede ser francesa (lo que Pokefus dejo sin traducir) o espanola (una
     * frase suya que reescribo), pero en los dos casos tiene que estar ahi.
     */
    const swf = ultimoArchivo(archivo + '_es_') || ultimoArchivo(archivo + '_fr_');
    if (!swf) { console.log(archivo.padEnd(10) + 'sin archivo en cache'); continue; }

    const dentro = new Set(
      resolvePushedStrings(fs.readFileSync(path.join(RAIZ, 'cache', swf)), false)
        .filter((s) => typeof s === 'string'));

    const sueltas = claves.filter((clave) => !dentro.has(clave));

    console.log(archivo.padEnd(10) + claves.length + ' entradas, ' +
      (sueltas.length ? sueltas.length + ' SIN CORRESPONDENCIA' : 'todas cuadran'));

    for (const clave of sueltas.slice(0, 12)) {
      console.log('     ' + JSON.stringify(clave).slice(0, 110));
    }

    huerfanas += sueltas.length;
  }

  console.log('\n' + (huerfanas
    ? huerfanas + ' claves no existen en el juego: esas traducciones no se aplican.'
    : 'Todas las claves existen en el juego.'));
}

main();
