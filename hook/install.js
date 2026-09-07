'use strict';

/*
 * Instala y desinstala el hook en el preloader del cliente.
 *
 * El launcher lleva el sha256 de preloader.js en version.control y lo restaura
 * en cada actualizacion, asi que esto no es permanente por diseno: se reaplica.
 * Por eso guarda copia del original y sabe deshacerse solo.
 *
 * El require va ANTES del bloque que carga main.jsc: ahi arranca el cliente, y
 * el desvio tiene que estar puesto antes de que pida nada.
 */

const fs = require('fs');
const path = require('path');

const PRELOADER = require('../src/instalacion').preloader();
const COPIA = path.join(__dirname, '..', 'backup', 'preloader.js.orig');
/* JSON.stringify escapa las barras invertidas de Windows al escribir el
 * require, asi que la ruta se deja tal cual la da path.join. */
const HOOK = path.join(__dirname, 'pokefus-es.js');

const MARCA_INICIO = '/* === pokefus-es: inicio === */';
const MARCA_FIN = '/* === pokefus-es: fin === */';

const ANCLA = `const fs = require('fs')\nconst path = require("path")\nif (fs.existsSync(path.join(__dirname, "main.jsc"))) {`;

const BLOQUE = [
  MARCA_INICIO,
  '// Traduccion al espanol en vivo. Se puede quitar con: node hook/install.js quitar',
  `try { require(${JSON.stringify(HOOK)}) } catch (e) { }`,
  MARCA_FIN,
  '',
].join('\n');

function leer() {
  return fs.readFileSync(PRELOADER, 'utf8');
}

function quitarBloque(texto) {
  const inicio = texto.indexOf(MARCA_INICIO);
  if (inicio === -1) return texto;

  const fin = texto.indexOf(MARCA_FIN, inicio);
  if (fin === -1) return texto;

  return texto.slice(0, inicio) + texto.slice(fin + MARCA_FIN.length).replace(/^\n/, '');
}

function poner() {
  const original = leer();

  fs.mkdirSync(path.dirname(COPIA), { recursive: true });
  if (!fs.existsSync(COPIA)) {
    fs.writeFileSync(COPIA, original);
    console.log('copia del original -> ' + COPIA);
  }

  const limpio = quitarBloque(original);
  if (!limpio.includes(ANCLA)) {
    console.error('ERROR: no se encuentra el punto de insercion en preloader.js.');
    console.error('El cliente ha cambiado; revisar el ancla antes de seguir.');
    process.exit(1);
  }

  fs.writeFileSync(PRELOADER, limpio.replace(ANCLA, BLOQUE + ANCLA));
  console.log('hook instalado en preloader.js');
  console.log('registro en: ' + path.join(__dirname, '..', 'hook.log'));
}

function quitar() {
  if (fs.existsSync(COPIA)) {
    fs.writeFileSync(PRELOADER, fs.readFileSync(COPIA));
    console.log('preloader.js restaurado desde la copia');
    return;
  }

  fs.writeFileSync(PRELOADER, quitarBloque(leer()));
  console.log('bloque retirado de preloader.js');
}

const accion = process.argv[2] === 'quitar' ? quitar : poner;
accion();
