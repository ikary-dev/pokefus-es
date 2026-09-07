'use strict';

/*
 * Prepara la carpeta que se le pasa a otra persona.
 *
 * Se copia lo justo para que funcione y se regenere, y se deja fuera todo lo
 * demas. Dos exclusiones importan de verdad:
 *
 *   backup/ NO SE COPIA NUNCA. Son los archivos originales de ESTA instalacion.
 *   En el otro ordenador el cliente puede estar en otra version, y restaurar
 *   estos encima seria dejarselo roto. Alli se crean solos la primera vez.
 *
 *   cache/ tampoco: son treinta megas de SWF descargados que el proxy vuelve a
 *   pedir cuando hagan falta.
 *
 * El resto que se queda fuera son listas de trabajo -- lo pendiente de traducir,
 * los volcados, los informes -- que no hacen falta para jugar.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const DESTINO = path.join(RAIZ, 'dist', 'pokefus-es');

/* Lo que se copia entero. */
const CARPETAS = ['src', 'hook'];
const ARCHIVOS = [
  'aplicar.js', 'empaquetar.js',
  'Pokefus en espanol.bat', 'quitar traduccion.bat',
  /*
   * Instrucciones y documentacion en los dos idiomas. README.md es solo el
   * indice: es el unico nombre que GitHub muestra en la portada del repositorio.
   */
  'README.md',
  'LEEME_es.txt', 'LEEME_fr.txt',
  'README_es.md', 'README_fr.md',
  /*
   * Va dentro a proposito: si alguien clona esto al lado del juego y lo
   * ejecuta, se crean backup/, cache/ y los registros. proxy.log lleva el
   * nombre del personaje, el chat y el token de sesion, asi que subirlo sin
   * querer seria filtrar datos de su partida.
   */
  '.gitignore',
];

/* De tm/ solo los diccionarios y las listas que permiten regenerarlos. */
const DICCIONARIOS = [
  'translations.json',   // archivos de idioma
  'core.json',           // interfaz propia (modules/core.swf)
  'loader.json',         // pantalla de conexion (loader.swf)
  'dom.json',
  'dom-fragmentos.json', // textos del panel que se componen con numeros dentro
  'guide.es.txt',        // guia del entrenador
  'server.json',         // frases del proxy, ya montado
  'nombres-fr-es.json',  // nombres sacados de los archivos del juego
  'nombres-manual.json', // correcciones a mano de esos nombres
  'plantillas-fr-es.json',
  /*
   * Los nombres de region. server.json ya los lleva dentro, pero sin este
   * archivo rehacerlo con src/server-dic.js perderia treinta y una entradas sin
   * decir nada, porque una fuente que falta se lee como vacia.
   */
  'regiones.json',
  'hints.json',          // nombres del mapa que no estan en los archivos del juego
];

/* Las fuentes con las que se rehace server.json tras una actualizacion. */
const FUENTES = [
  'server-manual.json',
  'server-capturado.json', 'server-capturado2.json', 'server-capturado3.json',
  'server-capturado4.json', 'server-capturado5.json', 'server-capturado6.json',
];

function copiarCarpeta(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });

  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const desde = path.join(origen, entrada.name);
    const hasta = path.join(destino, entrada.name);

    if (entrada.isDirectory()) copiarCarpeta(desde, hasta);
    else fs.copyFileSync(desde, hasta);
  }
}

function tamano(carpeta) {
  let total = 0;

  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    total += entrada.isDirectory() ? tamano(ruta) : fs.statSync(ruta).size;
  }

  return total;
}

function main() {
  /* rmdirSync y no rmSync: el segundo no existe en el Node 12 que trae el
   * juego, y todo esto tiene que poder ejecutarse con ese interprete. */
  try { fs.rmdirSync(path.join(RAIZ, 'dist'), { recursive: true }); }
  catch (error) { /* no existia */ }
  fs.mkdirSync(DESTINO, { recursive: true });

  for (const carpeta of CARPETAS) copiarCarpeta(path.join(RAIZ, carpeta), path.join(DESTINO, carpeta));

  for (const archivo of ARCHIVOS) {
    const desde = path.join(RAIZ, archivo);
    if (fs.existsSync(desde)) fs.copyFileSync(desde, path.join(DESTINO, archivo));
  }

  fs.mkdirSync(path.join(DESTINO, 'tm'), { recursive: true });
  let faltan = 0;

  for (const archivo of DICCIONARIOS.concat(FUENTES)) {
    const desde = path.join(RAIZ, 'tm', archivo);
    if (!fs.existsSync(desde)) { console.log('  falta ' + archivo); faltan++; continue; }
    fs.copyFileSync(desde, path.join(DESTINO, 'tm', archivo));
  }

  const kb = Math.round(tamano(DESTINO) / 1024);
  console.log('\ndist/pokefus-es  ->  ' + kb + ' KB' + (faltan ? '  (' + faltan + ' archivos no encontrados)' : ''));
  console.log('Comprime esa carpeta y pasala. Sin backup/ ni cache/, que son de esta instalacion.');
}

main();
