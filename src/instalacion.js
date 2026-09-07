'use strict';

/*
 * Encuentra la instalacion de Pokefus en este ordenador.
 *
 * Antes las rutas estaban escritas a mano, lo que ataba todo a una carpeta
 * concreta. Para que esto se pueda pasar a otra persona hay que dar con el
 * juego sin preguntarle nada.
 *
 * Se busca en tres sitios, en orden: junto a esta carpeta (el caso normal, si
 * se descomprime al lado del juego), en los sitios donde el instalador lo suele
 * dejar, y en las carpetas raiz de cada disco. Se para en el primero que tenga
 * las piezas que hacen falta.
 */

const fs = require('fs');
const path = require('path');

/* Lo que tiene que haber dentro para considerarlo una instalacion valida. */
const PIEZAS = [
  'client/Dofus Retro.exe',
  'client/resources/app/preloader.js',
  'client/resources/app/retroclient/config.xml',
];

function esInstalacion(carpeta) {
  return PIEZAS.every((pieza) => fs.existsSync(path.join(carpeta, pieza)));
}

/* Los nombres con los que se instala el juego. */
const NOMBRES = ['Pokefus UpLauncher', 'Pokefus', 'Pokefus Launcher'];

function candidatos() {
  const rutas = [];
  const casa = process.env.USERPROFILE || '';
  const raiz = path.join(__dirname, '..');

  // Al lado de esta carpeta, y un nivel mas arriba.
  rutas.push(path.join(raiz, '..'));
  for (const nombre of NOMBRES) {
    rutas.push(path.join(raiz, '..', nombre));
    rutas.push(path.join(raiz, '..', '..', nombre));
  }

  // Donde suele dejarlo el instalador.
  const bases = [
    casa && path.join(casa, 'Desktop'),
    casa && path.join(casa, 'Escritorio'),
    casa && path.join(casa, 'Downloads'),
    casa && path.join(casa, 'Documents'),
    casa,
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\', 'D:\\', 'E:\\',
  ].filter(Boolean);

  for (const base of bases) {
    for (const nombre of NOMBRES) {
      rutas.push(path.join(base, nombre));
      rutas.push(path.join(base, 'Pokefus', nombre));
    }
  }

  return rutas;
}

let encontrada = null;

function raizDelJuego() {
  if (encontrada) return encontrada;

  for (const ruta of candidatos()) {
    try { if (esInstalacion(ruta)) { encontrada = path.resolve(ruta); return encontrada; } }
    catch (error) { /* una ruta inaccesible no es un error, es que no es esa */ }
  }

  throw new Error(
    'No encuentro la instalacion de Pokefus.\n' +
    'Pon esta carpeta al lado de la carpeta del juego (la que contiene "client")\n' +
    'y vuelve a intentarlo.');
}

const dentro = (...partes) => path.join(raizDelJuego(), ...partes);

module.exports = {
  raizDelJuego: raizDelJuego,
  retroclient: () => dentro('client', 'resources', 'app', 'retroclient'),
  preloader: () => dentro('client', 'resources', 'app', 'preloader.js'),
  ejecutable: () => dentro('client', 'Dofus Retro.exe'),
  carpetaCliente: () => dentro('client'),
};
