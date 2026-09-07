'use strict';

/*
 * Traduce los nombres de los sitios del mapa.
 *
 * El panel del mapa no saca los nombres de ningun archivo de idioma: los lee de
 * clips/pokefus/worldmap/hints.js, un JSON generado aparte que viene solo en
 * frances. Por eso las etiquetas del mapa -- "Donjon des Scarafeuilles",
 * "Ateliers des mineurs" -- seguian sin traducir por mucho que se tocara todo
 * lo demas.
 *
 * Las traducciones ya existen: son las mismas que estan en el archivo hints del
 * juego en espanol, y ya salen emparejadas en tm/nombres-fr-es.json. Aqui solo
 * se aplican, sobre los campos "n" del JSON.
 *
 * Se toca UNICAMENTE el valor de "n". Las coordenadas, los identificadores y
 * los colores se quedan como estan: reescribir un JSON entero para cambiar unas
 * etiquetas es pedir un error de formato a cambio de nada.
 */

const fs = require('fs');
const path = require('path');

const CAMPO_NOMBRE = /("n"\s*:\s*)"((?:[^"\\]|\\.)*)"/g;

function traducirHints(texto, diccionario) {
  let cambiados = 0;
  let totales = 0;

  const salida = texto.replace(CAMPO_NOMBRE, function (entero, prefijo, valor) {
    totales++;

    /* El valor viene escapado a la manera de JSON; hay que leerlo y volver a
     * escribirlo igual, o un acento o una comilla romperia el archivo. */
    let claro;
    try { claro = JSON.parse('"' + valor + '"'); } catch (error) { return entero; }

    const traducido = diccionario[claro];
    if (!traducido) return entero;

    cambiados++;
    return prefijo + JSON.stringify(traducido);
  });

  return { texto: salida, cambiados: cambiados, totales: totales };
}

function main() {
  const raiz = path.join(__dirname, '..');
  const destino = path.join(require('./instalacion').retroclient(), 'clips', 'pokefus', 'worldmap', 'hints.js');
  const copia = path.join(raiz, 'backup', 'clips', 'pokefus', 'worldmap', 'hints.js');

  if (!fs.existsSync(destino)) { console.log('hints.js: no esta en este cliente'); return; }

  /*
   * Deshacer. Faltaba: "quitar traduccion" restauraba loader.swf, core.swf y el
   * preloader, pero de los nombres del mapa no se acordaba, asi que el cliente
   * NO quedaba como estaba, que es justo lo que promete el LEEME.
   */
  if (process.argv[2] === 'restaurar') {
    if (!fs.existsSync(copia)) { console.log('hints.js: sin copia, no hay nada que restaurar'); return; }
    fs.copyFileSync(copia, destino);
    console.log('clips/pokefus/worldmap/hints.js restaurado desde la copia');
    return;
  }

  fs.mkdirSync(path.dirname(copia), { recursive: true });

  /*
   * La copia solo se hace si lo que hay es el original. Si ya estuviera
   * traducido se guardaria el espanol como si fuera el frances y no habria
   * vuelta atras. Se distingue por el idioma de los nombres del propio archivo.
   */
  if (!fs.existsSync(copia)) {
    const contenido = fs.readFileSync(destino, 'utf8');
    const nombres = JSON.parse(fs.readFileSync(path.join(raiz, 'tm', 'nombres-fr-es.json'), 'utf8'));
    const muestra = Object.entries(nombres).filter((par) => par[0].length >= 8).slice(0, 600);

    let enFrances = 0;
    let enEspanol = 0;

    for (const [frances, espanol] of muestra) {
      if (contenido.indexOf(frances) !== -1) enFrances++;
      if (contenido.indexOf(espanol) !== -1) enEspanol++;
    }

    if (enEspanol > enFrances) {
      console.log('hints.js: ya esta traducido y no hay copia del original.');
      console.log('   Abre el launcher de Pokefus una vez para que lo restaure, y vuelve a ejecutar.');
      return;
    }

    fs.copyFileSync(destino, copia);
  }

  const diccionario = JSON.parse(fs.readFileSync(path.join(raiz, 'tm', 'nombres-fr-es.json'), 'utf8'));
  const propio = fs.existsSync(path.join(raiz, 'tm', 'hints.json'))
    ? JSON.parse(fs.readFileSync(path.join(raiz, 'tm', 'hints.json'), 'utf8'))
    : {};

  const resultado = traducirHints(fs.readFileSync(copia, 'utf8'), Object.assign({}, diccionario, propio));

  /* Se comprueba que sigue siendo JSON valido antes de escribirlo. */
  const json = /window\.pokefusMapHints\s*=\s*([\s\S]*?);?\s*$/.exec(resultado.texto);
  try { JSON.parse(json[1]); }
  catch (error) { console.log('hints.js: la traduccion lo dejaria mal formado, no se toca'); return; }

  fs.writeFileSync(destino, resultado.texto);
  console.log('clips/pokefus/worldmap/hints.js: ' + resultado.cambiados + '/' + resultado.totales + ' nombres traducidos');
}

if (require.main === module) main();
module.exports = { traducirHints };
