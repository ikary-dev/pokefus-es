'use strict';

/*
 * Saca el texto frances de la capa HTML del cliente.
 *
 * El panel lateral, el mapa y el chat no son Flash: los dibuja Electron desde
 * unos pocos .js y .html que viven dentro de la instalacion. El traductor de la
 * pagina solo cambia lo que encuentra en el diccionario, asi que todo lo que no
 * estuviera apuntado seguia saliendo en frances -- y ahi estaban los botones
 * (UNIRSE, PROGRESION, AMIGOS), los avisos del mapa ("Ouvre : ...") y las
 * infobulbas.
 *
 * Buscarlo a ojo no sirve: son mil setecientos kilobytes de codigo. Esto recorre
 * las cadenas literales y se queda con las que parecen texto de pantalla en
 * frances, descartando lo que es codigo (selectores, clases CSS, nombres de
 * evento, rutas).
 *
 *   node src/extraer-html.js         lo que falta por traducir
 *   node src/extraer-html.js todo    tambien lo ya traducido
 */

const fs = require('fs');
const path = require('path');

const RETROCLIENT = require('./instalacion').retroclient();
const TM = path.join(__dirname, '..', 'tm');

const ARCHIVOS = [
  'js/pokefus-panel.js',
  'js/pokefus-gamemap.js',
  'js/D1Chat.js',
  'js/D1Console.js',
  'js/D1ElectronLauncher.js',
  'D1Chat.html',
  'D1Console.html',
  'D1ElectronLauncher.html',
];

const FRANCES = /[àâçèéêëîïôùûœ]|\b(le|la|les|du|des|de|un|une|au|aux|et|en|sur|sans|pour|avec|qui|que|dans|vers|chez|sous|vous|votre|ton|ta|tes|est|sont|pas|plus|ne|se|ce|cette|aucun|aucune|tout|tous|toute|par|entre|depuis|selon)\b/i;

/* Lo que es codigo, no texto: se reconoce por la forma, no por el idioma. */
const NO_ES_TEXTO = [
  /^[a-z][a-zA-Z0-9_]*$/,          // identificador
  /^[.#][a-zA-Z0-9_-]+$/,          // selector CSS
  /^[a-z-]+$/,                     // clase o propiedad
  /^\//,                           // ruta
  /^https?:/,
  /^\d+(\.\d+)?[a-z%]*$/,          // medida
  /^#[0-9a-fA-F]{3,8}$/,           // color
  /^[A-Z_]+$/,                     // constante
  /[{}<>$]/,                       // plantilla o markup suelto
  /^[^a-zA-ZÀ-ÿ]*$/,               // sin letras
];

/*
 * Se leen las cadenas entre comillas del propio fuente. Es tosco a proposito:
 * un analizador de JavaScript seria mas exacto, pero aqui solo hace falta
 * encontrar candidatos para revisar a mano.
 */
function literales(texto) {
  const salida = [];
  const patron = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|>([^<>{}]{3,80})</g;
  let coincidencia;

  while ((coincidencia = patron.exec(texto)) !== null) {
    const cadena = coincidencia[1] !== undefined ? coincidencia[1]
      : coincidencia[2] !== undefined ? coincidencia[2]
        : coincidencia[3];

    if (cadena) salida.push(cadena.replace(/\\'/g, "'").replace(/\\"/g, '"').trim());
  }

  return salida;
}

function main() {
  const todo = process.argv[2] === 'todo';

  const leer = (nombre) => {
    const ruta = path.join(TM, nombre);
    return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
  };

  const yaEsta = Object.assign({}, leer('dom.json'), leer('dom-fragmentos.json'));
  const vistas = new Set();
  const encontradas = [];

  for (const relativo of ARCHIVOS) {
    const ruta = path.join(RETROCLIENT, relativo);
    if (!fs.existsSync(ruta)) continue;

    for (const cadena of literales(fs.readFileSync(ruta, 'utf8'))) {
      if (cadena.length < 3 || cadena.length > 120 || vistas.has(cadena)) continue;
      if (NO_ES_TEXTO.some((patron) => patron.test(cadena))) continue;
      if (!FRANCES.test(cadena)) continue;
      if (!todo && Object.prototype.hasOwnProperty.call(yaEsta, cadena)) continue;

      vistas.add(cadena);
      encontradas.push(path.basename(relativo) + ' | ' + cadena);
    }
  }

  for (const linea of encontradas) console.log(linea);
  console.log('\n' + encontradas.length + ' cadenas');
}

main();
