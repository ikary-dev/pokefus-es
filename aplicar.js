'use strict';

/*
 * Un solo comando: node aplicar.js
 *
 * El launcher lleva el sha256 de cada archivo del cliente y restaura los que no
 * cuadran, asi que despues de cada actualizacion hay que volver a poner las dos
 * piezas que viven dentro de la instalacion: el parche de loader.swf y la linea
 * que carga el hook en preloader.js. Todo lo demas -- los archivos de idioma y
 * la capa HTML -- se traduce al vuelo y no necesita nada.
 *
 * Es idempotente: se puede ejecutar las veces que haga falta. El parche siempre
 * se rehace desde la copia del original, y la linea del preloader se quita antes
 * de volver a ponerla.
 *
 *   node aplicar.js          pone la traduccion
 *   node aplicar.js quitar   deja el cliente como estaba
 */

const { execFileSync } = require('child_process');
const path = require('path');

/*
 * Antes de parchear, ponerse al dia con el servidor.
 *
 * Cuando Pokefus actualiza, los archivos de idioma cambian de version. Los
 * nuevos traen monstruos, objetos y hechizos que el diccionario de nombres no
 * conoce, y saldrian en frances hasta que alguien lo regenerase a mano. Bajando
 * las dos versiones -- la francesa y la espanola -- y volviendo a cruzarlas, el
 * diccionario se pone al dia solo.
 *
 * Los tres pasos toleran fallo: sin internet, o si Pokefus esta caido, se sigue
 * adelante con lo que ya hay en disco. Traducir con el diccionario de ayer es
 * mucho mejor que no arrancar.
 */
const puestaAlDia = [
  /*
   * Lo primero: comprobar que las copias de los archivos del cliente siguen
   * siendo las de la version instalada. Si Pokefus actualizo uno, la copia se
   * queda vieja y el parche la restauraria encima de la nueva, devolviendo al
   * jugador a la version anterior sin que nada lo advierta. Ya paso.
   */
  { nombre: 'originales del cliente', guion: path.join(__dirname, 'src', 'originales.js') },
  { nombre: 'archivos de idioma', guion: path.join(__dirname, 'src', 'actualizar.js') },
  { nombre: 'diccionario de nombres', guion: path.join(__dirname, 'src', 'pares.js') },
  { nombre: 'lista de pendientes', guion: path.join(__dirname, 'src', 'pendientes.js') },
];

const pasos = [
  { nombre: 'loader.swf', guion: path.join(__dirname, 'src', 'patch-local.js') },
  { nombre: 'nombres del mapa', guion: path.join(__dirname, 'src', 'hints.js') },
  { nombre: 'hook en preloader.js', guion: path.join(__dirname, 'hook', 'install.js') },
];

const quitar = process.argv[2] === 'quitar';

if (!quitar) {
  console.log('Poniendome al dia con el servidor (la primera vez tarda un par de minutos)...');

  for (const paso of puestaAlDia) {
    try {
      const salida = execFileSync(process.execPath, [paso.guion], {
        encoding: 'utf8',
        timeout: 120000,
      });

      // Solo la ultima linea: el detalle no interesa en cada arranque.
      const lineas = salida.trim().split(String.fromCharCode(10));
      const ultima = lineas[lineas.length - 1];
      if (ultima) console.log(paso.nombre + ': ' + ultima.trim());
    } catch (error) {
      console.log(paso.nombre + ': sin actualizar (se sigue con lo que hay)');
    }
  }
}

for (const paso of pasos) {
  // install.js espera 'quitar' y patch-local.js espera 'restaurar'.
  const args = quitar
    ? [paso.guion, paso.guion.includes('install') ? 'quitar' : 'restaurar']
    : [paso.guion];

  try {
    const salida = execFileSync(process.execPath, args, { encoding: 'utf8' });
    process.stdout.write(salida);
  } catch (error) {
    process.stdout.write(error.stdout || '');
    console.error('FALLO en ' + paso.nombre);
    process.exit(1);
  }
}

console.log(quitar
  ? '\nCliente restaurado.'
  : '\nListo. Arranca el juego normalmente.');
