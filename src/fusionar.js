'use strict';

/*
 * Mete en la memoria de traduccion las listas traducidas por indice.
 *
 * El texto del juego viene partido en fragmentos de linea, muchos con espacios
 * finales que cuentan: al concatenarlos forman el parrafo. Copiar esas cadenas a
 * mano como claves de un JSON es la mejor forma de perder un espacio y que la
 * traduccion no case nunca. Asi que se traduce una lista posicional --
 * tm/trad-<archivo>.json, en el mismo orden que tm/por-traducir.json -- y aqui
 * se emparejan, tomando la clave del original tal cual esta.
 *
 * Una entrada vacia o null deja esa cadena sin traducir, que es lo que se hace
 * con los nombres propios.
 */

const fs = require('fs');
const path = require('path');

const TM = path.join(__dirname, '..', 'tm');
const DESTINO = path.join(TM, 'translations.json');

function cargar(nombre) {
  const ruta = path.join(TM, nombre);
  return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : null;
}

function main() {
  const origen = cargar('por-traducir.json');
  if (!origen) throw new Error('falta tm/por-traducir.json: ejecuta antes src/extract.js');

  const memoria = cargar('translations.json') || { revision: 1, files: {} };
  let anadidas = 0;

  /*
   * Un archivo grande se traduce por partes: trad-dialog-a.json, -b, -c... Se
   * pegan en orden alfabetico, que es el orden en que se trocearon. dialog trae
   * quinientas y pico frases y de una sentada no cabe.
   */
  const listaDe = function (archivo) {
    const entera = cargar('trad-' + archivo + '.json');
    if (entera) return entera;

    const partes = fs.readdirSync(TM)
      .filter((nombre) => nombre.startsWith('trad-' + archivo + '-') && nombre.endsWith('.json'))
      .sort();

    if (!partes.length) return null;
    return partes.reduce((todas, parte) => todas.concat(cargar(parte)), []);
  };

  for (const archivo of Object.keys(origen)) {
    const traducciones = listaDe(archivo);
    if (!traducciones) continue;

    const originales = origen[archivo];
    if (traducciones.length !== originales.length) {
      throw new Error(`trad-${archivo}.json tiene ${traducciones.length} entradas y se esperaban ${originales.length}`);
    }

    if (!memoria.files[archivo]) memoria.files[archivo] = {};

    for (let i = 0; i < originales.length; i++) {
      const traducida = traducciones[i];
      if (!traducida || traducida === originales[i]) continue;

      memoria.files[archivo][originales[i]] = traducida;
      anadidas++;
    }
  }

  /* Subir la revision es lo que hace que el cliente tire su cache de Flash y
   * vuelva a pedir los archivos. Sin esto, la traduccion nueva no se veria. */
  memoria.revision = (memoria.revision || 1) + 1;
  fs.writeFileSync(DESTINO, JSON.stringify(memoria, null, 1));

  const total = Object.values(memoria.files).reduce((suma, tabla) => suma + Object.keys(tabla).length, 0);
  console.log(anadidas + ' anadidas | ' + total + ' traducciones en total | revision ' + memoria.revision);
}

main();
