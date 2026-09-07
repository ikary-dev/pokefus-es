'use strict';

/*
 * Compara TODO el cliente con el manifiesto oficial del launcher.
 *
 * El launcher deja en "version.control" el sha256 y el tamano de los 23 750
 * archivos que ha instalado. Esto los recorre y dice cuales no cuadran.
 *
 * Los unicos que deben salir son los cinco que tocamos a proposito: loader.swf,
 * modules/core.swf, clips/pokefus/guide.txt, worldmap/hints.js y preloader.js.
 * Si aparece cualquier otro, algo va mal.
 *
 * Con esto se encontro el peor fallo que ha tenido este proyecto: la copia del
 * original se habia quedado en la version anterior y el parche la restauraba
 * encima de la nueva en cada arranque, devolviendo el juego a la semana pasada.
 * El jugador perdio el relevo en combate, el dano estimado y la caja de
 * Dofemons, y mientras tanto la traduccion se veia perfecta. Nada en el codigo
 * de la traduccion lo delataba: habia que preguntarselo al propio juego.
 *
 *   node src/comprobar-cliente.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = require('./instalacion').raizDelJuego();

/* Los que traducimos: es normal que no cuadren. */
const NUESTROS = [
  'resources/app/preloader.js',
  'resources/app/retroclient/loader.swf',
  'resources/app/retroclient/modules/core.swf',
  'resources/app/retroclient/clips/pokefus/guide.txt',
  'resources/app/retroclient/clips/pokefus/worldmap/hints.js',
  'resources/app/retroclient/config.xml',   // lo reescribe el proxy para apuntar a si mismo
];

const huella = (ruta) => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
const normalizar = (ruta) => ruta.split('\\').join('/');

function main() {
  const control = path.join(RAIZ, 'version.control');
  if (!fs.existsSync(control)) {
    console.log('no encuentro version.control: sin manifiesto no hay nada que comparar');
    return;
  }

  const manifiesto = JSON.parse(fs.readFileSync(control, 'utf8'));
  const archivos = manifiesto.files || [];

  console.log('version instalada: ' + manifiesto.version + '   archivos: ' + archivos.length);

  const distintos = [];
  let iguales = 0;
  let faltan = 0;

  for (const entrada of archivos) {
    const relativo = normalizar(entrada.path);
    const local = path.join(RAIZ, 'client', relativo);

    if (!fs.existsSync(local)) { faltan++; continue; }
    if (huella(local) === entrada.sha) { iguales++; continue; }

    distintos.push({
      ruta: relativo,
      oficial: entrada.size,
      hay: fs.statSync(local).size,
      nuestro: NUESTROS.indexOf(relativo) !== -1,
    });
  }

  console.log('coinciden: ' + iguales + '   distintos: ' + distintos.length + '   no estan: ' + faltan);

  for (const d of distintos) {
    console.log('   ' + (d.nuestro ? '(traducido)  ' : 'SIN EXPLICAR ') + d.ruta +
      '   oficial ' + d.oficial + ' B / en disco ' + d.hay + ' B');
  }

  const ajenos = distintos.filter((d) => !d.nuestro);

  console.log(ajenos.length
    ? '\nHay ' + ajenos.length + ' archivo(s) que no tocamos y aun asi no cuadran.'
    : '\nTodo lo demas coincide con el cliente oficial.');
}

main();
