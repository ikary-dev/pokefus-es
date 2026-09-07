'use strict';

/*
 * Memoria de traduccion.
 *
 * Un objeto por archivo de idioma, del texto original al traducido. La clave es
 * el texto de origen y no una posicion, asi que una traduccion sobrevive a que
 * Pokefus reordene, anada o quite entradas: mientras la frase francesa siga
 * siendo la misma, su traduccion sigue valiendo.
 *
 * `revision` es lo que hace que el cliente se entere de un cambio. El cliente
 * cachea los bancos de datos en el almacenamiento de Flash y solo los vuelve a
 * pedir cuando sube la version del archivo, de modo que servir contenido nuevo
 * bajo la misma version no se veria nunca. Subir la revision cambia la version
 * sintetica que anunciamos, y el cliente invalida su cache por su cuenta.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'tm', 'translations.json');

function load() {
  if (!fs.existsSync(FILE)) return { revision: 1, files: {} };

  const memory = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!memory.files) memory.files = {};
  if (!memory.revision) memory.revision = 1;
  return memory;
}

function save(memory) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(memory, null, 1));
}

function translationsFor(memory, name) {
  const entries = memory.files[name];
  return new Map(entries ? Object.entries(entries) : []);
}

/*
 * Version sintetica: la real con la revision pegada detras, en tres digitos.
 * Sigue siendo un numero y sigue creciendo cuando crece cualquiera de las dos,
 * que es lo unico que el cliente necesita para considerarla mas nueva.
 */
function syntheticVersion(realVersion, revision) {
  return String(realVersion) + String(revision % 1000).padStart(3, '0');
}

function realVersion(synthetic) {
  const text = String(synthetic);
  return text.length > 3 ? text.slice(0, -3) : text;
}

module.exports = { FILE, load, save, translationsFor, syntheticVersion, realVersion };
