'use strict';

/*
 * Descarga de los ficheros de idioma de Pokefus.
 *
 * El cliente no adivina que ficheros pedir: lee un manifiesto por idioma que
 * lista nombre, idioma y version de cada uno. Ese manifiesto es tambien
 * nuestro detector de actualizaciones -- si una version sube, hay texto nuevo
 * que mirar, y no hace falta saber nada de la version del cliente.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://pokefus.org/client/';
const CACHE = path.join(__dirname, '..', 'cache');

/* Formato: &f=items,es,1180|dialog,es,1210|lang,es,1162|... */
async function fetchManifest(lang) {
  const response = await fetch(`${BASE}lang/versions_${lang}.txt`);
  if (!response.ok) throw new Error(`manifiesto ${lang}: HTTP ${response.status}`);

  const text = await response.text();
  const entries = new Map();

  for (const chunk of text.replace(/^&f=/, '').split('|')) {
    const [name, entryLang, version] = chunk.split(',');
    if (name && version) entries.set(name, { name, lang: entryLang, version });
  }

  return entries;
}

/*
 * Cada SWF es inmutable: su version va en el nombre. Asi que una vez en disco
 * no se vuelve a pedir nunca, y el coste de red de un parche se limita a los
 * ficheros que de verdad cambiaron.
 */
async function fetchSwf(name, lang, version) {
  const file = `${name}_${lang}_${version}.swf`;
  const cached = path.join(CACHE, file);

  if (fs.existsSync(cached)) return { file, buffer: fs.readFileSync(cached), fromCache: true };

  const response = await fetch(`${BASE}lang/swf/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, buffer);
  return { file, buffer, fromCache: false };
}

module.exports = { BASE, CACHE, fetchManifest, fetchSwf };
