'use strict';

/*
 * Saca del trafico grabado todo el texto que sigue saliendo en frances.
 *
 * Los archivos del juego se pueden leer enteros y saber que falta. Lo que manda
 * el servidor, no: solo se ve lo que ha pasado por delante. Por eso el proxy
 * apunta lo que no sabe traducir mientras se juega, y este programa vuelve a
 * pasar proxy.log entero por el traductor para reunirlo todo de una vez.
 *
 * Cuenta dos cosas distintas, y la segunda es la que mas molesta al jugar:
 *
 *   SIN TOCAR   la frase entera salio en frances
 *   A MEDIAS    el diccionario acerto un trozo y el resto quedo en frances,
 *               asi que se lee "ce n'était pas une bicho sauvage" -- mitad y
 *               mitad. Es peor que dejarlo entero en frances.
 *
 * Se ordena por veces vistas: lo que mas se repite es lo que mas se lee.
 *
 *   node src/pendientes-red.js            informe por pantalla
 *   node src/pendientes-red.js --guardar  ademas escribe tm/faltan-red.json
 */

const fs = require('fs');
const path = require('path');
const { crearTraductor } = require('./proxy');

const RAIZ = path.join(__dirname, '..');

/* Las mismas fuentes que usa el proxy de verdad, para que el resultado cuadre. */
function leer(archivo) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', archivo), 'utf8'));
}

function leerNombres() {
  const nombres = Object.assign({}, leer('nombres-fr-es.json'), leer('nombres-manual.json'));
  const traducciones = leer('translations.json').files || {};

  for (const grupo of ['npc', 'monsters', 'items', 'maps', 'titles']) {
    Object.assign(nombres, traducciones[grupo] || {});
  }

  return nombres;
}

/*
 * Lo que no es texto para leer: coordenadas, listas de numeros, banderas del
 * protocolo. Entran por el mismo sitio y ensucian el informe.
 */
const SOLO_DATOS = /^[-+0-9;,|^#.a-f]+$/i;
const TIENE_PALABRA = /[A-Za-zÀ-ÿ]{4}/;

function main() {
  const registro = path.join(RAIZ, 'proxy.log');

  if (!fs.existsSync(registro)) {
    console.log('No hay proxy.log. Crea tm/debug-proxy, juega un rato y vuelve.');
    return;
  }

  /*
   * Dos mapas y no uno con el tipo pegado delante: el texto lleva espacios, asi
   * que no hay separador que valga para volver a partirlo despues.
   */
  const aMedias = new Map();
  const sinTocar = new Map();

  const apuntar = function (campo) {
    const medias = campo.indexOf('A MEDIAS: ') === 0;
    const texto = medias ? campo.slice(10) : campo;

    if (SOLO_DATOS.test(texto) || !TIENE_PALABRA.test(texto)) return;

    const cuenta = medias ? aMedias : sinTocar;
    cuenta.set(texto, (cuenta.get(texto) || 0) + 1);
  };

  const traducir = crearTraductor(
    () => ({ frases: leer('server.json'), nombres: leerNombres() }), apuntar);

  let mensajes = 0;

  for (const linea of fs.readFileSync(registro, 'utf8').split('\n')) {
    if (!linea) continue;

    let mensaje;
    try { mensaje = JSON.parse(linea); } catch (error) { continue; }

    traducir(mensaje);
    mensajes++;
  }

  const ordenar = (mapa, tipo) => [...mapa.entries()]
    .map(([texto, veces]) => ({ tipo, texto, veces }))
    .sort((a, b) => b.veces - a.veces || b.texto.length - a.texto.length);

  const medias = ordenar(aMedias, 'A MEDIAS');
  const enteras = ordenar(sinTocar, 'SIN TOCAR');
  const filas = medias.concat(enteras);

  console.log(mensajes + ' mensajes releidos\n');
  console.log(medias.length + ' frases traducidas A MEDIAS (las peores de leer)');
  console.log(enteras.length + ' frases SIN TOCAR\n');

  for (const fila of medias.slice(0, 15)) {
    console.log('  x' + String(fila.veces).padEnd(4) + fila.texto.replace(/\n/g, ' ').slice(0, 130));
  }

  console.log('');

  for (const fila of enteras.slice(0, 15)) {
    console.log('  x' + String(fila.veces).padEnd(4) + fila.texto.replace(/\n/g, ' ').slice(0, 130));
  }

  if (process.argv.indexOf('--guardar') !== -1) {
    const salida = path.join(RAIZ, 'tm', 'faltan-red.json');
    fs.writeFileSync(salida, JSON.stringify(filas, null, 1));
    console.log('\n' + filas.length + ' frases -> tm/faltan-red.json');
  }
}

main();
