'use strict';

/*
 * Busca texto sin traducir en los SWF que el cliente carga desde el disco.
 *
 * loader.swf y modules/core.swf no pasan por la red, asi que el truco del
 * diff ES/FR no sirve con ellos: no hay pareja con la que comparar. Aqui se
 * listan directamente todas las cadenas de prosa que el bytecode empuja y que
 * el diccionario todavia no cubre, y se aparta lo que no se debe tocar.
 *
 * Filtrar bien importa mas que en los archivos de idioma: estos son codigo, y
 * traducir un identificador o una clave interna rompe el cliente. Se descartan
 * los rastros de depuracion -- que aqui son legion, del tipo "sprite=" o
 * "focus : demande sur " -- y las palabras sueltas en minuscula, que suelen ser
 * claves de un switch y no algo que el jugador llegue a leer.
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');
const { classify } = require('./classify');

const BACKUP = path.join(__dirname, '..', 'backup');
const TM = path.join(__dirname, '..', 'tm');

const OBJETIVOS = [
  { archivo: 'loader.swf', diccionario: 'loader.json' },
  { archivo: 'modules/core.swf', diccionario: 'core.json' },
];

/* Rastros de depuracion: pares clave=valor, listas y trozos de marcado. */
const DEPURACION = /=$|\[$|^\.|\\"|%%|\(s\)|="/;

/* Un token en minuscula sin espacios es casi siempre una clave interna. */
const CLAVE_INTERNA = /^[a-z][a-zA-Z0-9_-]*$/;

function pendientes(objetivo) {
  const original = path.join(BACKUP, objetivo.archivo);
  if (!fs.existsSync(original)) {
    console.log(objetivo.archivo + ': sin copia original, ejecuta antes node aplicar.js');
    return [];
  }

  const rutaDiccionario = path.join(TM, objetivo.diccionario);
  const diccionario = fs.existsSync(rutaDiccionario)
    ? JSON.parse(fs.readFileSync(rutaDiccionario, 'utf8'))
    : {};

  const vistas = new Set();
  for (const texto of resolvePushedStrings(fs.readFileSync(original))) {
    if (typeof texto === 'string') vistas.add(texto);
  }

  return [...vistas].filter((texto) =>
    classify(texto) === 'prose'
    && !diccionario[texto]
    && !DEPURACION.test(texto)
    && !CLAVE_INTERNA.test(texto)).sort();
}

for (const objetivo of OBJETIVOS) {
  const lista = pendientes(objetivo);
  const salida = 'pendientes-' + path.basename(objetivo.archivo, '.swf') + '.json';

  fs.writeFileSync(path.join(TM, salida), JSON.stringify(lista, null, 1));
  console.log(objetivo.archivo.padEnd(18) + String(lista.length).padStart(5) + ' sin traducir -> tm/' + salida);
}
