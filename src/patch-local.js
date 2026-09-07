'use strict';

/*
 * Parchea los SWF que el cliente carga desde el disco, no desde la red.
 *
 * loader.swf es el cliente entero, y lleva el texto de la pantalla de conexion
 * incrustado. No pasa por pokefus.org, asi que el desvio de red no lo alcanza:
 * hay que reescribir el archivo. Se guarda copia del original y se parchea
 * siempre a partir de esa copia, de modo que volver a ejecutarlo con un
 * diccionario corregido no acumula parches sobre parches.
 */

const fs = require('fs');
const path = require('path');
const { repackLangSwf } = require('./repack');
const { readSwf } = require('./swf');
const { resolvePushedStrings } = require('./resolve');
const { cadenasIntocables } = require('./riesgo');
const crypto = require('crypto');

const huella = (datos) => crypto.createHash('sha256').update(datos).digest('hex');

/*
 * Decide si hay que rehacer la copia del original.
 *
 * La copia se hacia una sola vez, la primera, y no se volvia a mirar. Eso
 * funciona mientras Pokefus no toque el archivo; el dia que lo actualiza, la
 * copia se queda con la version vieja y este programa la restaura encima de la
 * nueva en cada arranque. El jugador pierde lo que trajo la actualizacion sin
 * entender por que: aqui costo el relevo en combate, el dano estimado y la caja
 * de Dofemons, que eran funciones nuevas.
 *
 * Se distingue por la huella: al terminar se guarda la del archivo que dejamos
 * escrito. Si lo que hay en disco coincide, es lo nuestro y la copia sigue
 * valiendo. Si no coincide, es que el launcher lo ha repuesto -- o sea, es un
 * original nuevo -- y la copia hay que rehacerla.
 */
function copiaCaducada(destino, copia) {
  if (!fs.existsSync(copia)) return false;

  const marca = copia + '.huella';
  if (!fs.existsSync(marca)) return false;   // sin marca no se puede saber: se respeta

  const ahora = huella(fs.readFileSync(destino));

  // Es lo que dejamos nosotros: nada que hacer.
  if (fs.readFileSync(marca, 'utf8').trim() === ahora) return false;

  /*
   * Y si lo que hay en disco es identico a la copia, tampoco: eso pasa despues
   * de "quitar traduccion", que restaura el original. Sin esta segunda
   * condicion se anunciaba una actualizacion del juego que no habia ocurrido.
   */
  return huella(fs.readFileSync(copia)) !== ahora;
}

const RETROCLIENT = require('./instalacion').retroclient();
const BACKUP = path.join(__dirname, '..', 'backup');

/*
 * loader.swf es codigo, no datos: se reescribe por el pool. La otra estrategia
 * -- convertir la referencia en literal -- desplazaria el codigo que hay detras
 * y dejaria los saltos y los codeSize de las funciones apuntando a otro sitio.
 */
const OBJETIVOS = [
  { archivo: 'loader.swf', diccionario: 'loader.json', estrategia: 'pool' },
  // modules/core.swf lleva TODA la interfaz propia de Pokefus: equipo, misiones,
  // renombre, mochila, panoplia. Ese texto no pasa por los archivos de idioma
  // ni por la red, de modo que solo se alcanza parcheando el archivo.
  { archivo: 'modules/core.swf', diccionario: 'core.json', estrategia: 'pool' },
];

/*
 * Comprueba que el archivo que se va a guardar como "original" lo sea de verdad.
 *
 * La copia de seguridad se hace una sola vez, la primera. Si en ese momento el
 * archivo ya estuviera traducido -- porque alguien copio una instalacion ya
 * parcheada, o borro la carpeta backup y volvio a ejecutar -- la copia guardaria
 * el espanol como si fuera el frances original. A partir de ahi, "quitar
 * traduccion" dejaria el cliente igual y no habria forma de volver atras.
 *
 * Se distingue mirando el propio diccionario: en el original tienen que aparecer
 * las cadenas en frances, no las traducciones.
 */
function pareceOriginal(destino, tabla) {
  // Un SWF viene comprimido: hay que abrirlo para poder buscar dentro. Sin esto
  // la comprobacion no encontraba nada y daba por original cualquier archivo.
  const crudo = fs.readFileSync(destino);
  const contenido = destino.endsWith('.swf') ? readSwf(crudo).body : crudo;
  /*
   * Se miran TODAS las entradas utiles, no una muestra. Con las primeras
   * cuatrocientas el resultado de loader.swf salia 3 contra 2, que no distingue
   * nada; con la tabla entera sale 76 contra 7 en el original y 9 contra 72 en
   * el ya traducido, que no deja lugar a duda.
   */
  const muestra = Object.entries(tabla)
    .filter((par) => par[0].length >= 5 && par[0] !== par[1]);

  if (muestra.length < 10) return true;   // sin material para juzgar, se confia

  let enFrances = 0;
  let enEspanol = 0;

  for (const [frances, espanol] of muestra) {
    if (contenido.indexOf(Buffer.from(frances, 'utf8')) !== -1) enFrances++;
    if (contenido.indexOf(Buffer.from(espanol, 'utf8')) !== -1) enEspanol++;
  }

  return enFrances > enEspanol;
}

function parchear(objetivo) {
  const destino = path.join(RETROCLIENT, objetivo.archivo);
  const copia = path.join(BACKUP, objetivo.archivo);
  const tablaGuardia = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'tm', objetivo.diccionario), 'utf8'));

  fs.mkdirSync(path.dirname(copia), { recursive: true });

  // Pokefus lo ha repuesto: lo de disco es el original nuevo, no lo nuestro.
  if (copiaCaducada(destino, copia)) {
    fs.copyFileSync(destino, copia);
    console.log(objetivo.archivo + ': el juego se actualizo, copia del original rehecha');
  }

  if (!fs.existsSync(copia)) {
    if (!pareceOriginal(destino, tablaGuardia)) {
      console.log(objetivo.archivo + ': ya esta traducido y no hay copia del original.');
      console.log('   Abre el launcher de Pokefus una vez para que restaure el archivo, y vuelve a ejecutar.');
      return false;
    }

    fs.copyFileSync(destino, copia);
  }

  const original = fs.readFileSync(copia);
  const tabla = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tm', objetivo.diccionario), 'utf8'));

  /*
   * No todas las cadenas del pool son texto: algunas son nombres de propiedad o
   * terminos de una comparacion. Traducir una de esas no se nota como un fallo
   * de idioma sino como una funcion que deja de andar -- fue lo que paso con
   * "niveau", que el codigo usa para LEER una propiedad: traducirlo hacia que
   * leyera "nivel", que no existe, y el contador de la barra de turnos dejo de
   * salir.
   *
   * Se detectan mirando que hace el bytecode justo despues de apilarlas, y se
   * apartan solas. Asi el diccionario puede llevarlas sin peligro.
   */
  const intocables = cadenasIntocables(copia, tabla);
  const traducciones = new Map(Object.entries(tabla).filter(function (par) {
    return !intocables.has(par[0]);
  }));

  if (intocables.size) {
    console.log(objetivo.archivo + ': ' + intocables.size + ' cadenas apartadas por no ser texto (' +
      [...intocables].slice(0, 4).map(function (c) { return JSON.stringify(c); }).join(', ') + ')');
  }

  const resultado = repackLangSwf(original, traducciones, { estrategia: objetivo.estrategia });
  fs.writeFileSync(destino, resultado.buffer);
  fs.writeFileSync(copia + '.huella', huella(resultado.buffer));

  /* Se relee lo escrito: la unica prueba de que la traduccion esta dentro. */
  /*
   * Se cuenta buscando los bytes dentro del archivo ya escrito, no leyendo lo
   * que el bytecode apila. Los bloques protegidos, que se traducen escribiendo
   * encima, no se pueden recorrer como codigo, asi que por ahi salian sin
   * contar: el informe decia 43 de 76 cuando dentro habia 72. Un contador que
   * se queda corto es tan enganoso como uno que se pasa.
   */
  const cuerpo = readSwf(fs.readFileSync(destino)).body;
  const hayDentro = (texto) => cuerpo.indexOf(Buffer.from(texto, 'utf8')) !== -1;

  const puestas = [...traducciones.values()].filter(hayDentro);
  const restos = [...traducciones.keys()].filter(hayDentro);

  console.log(objetivo.archivo + ': ' + puestas.length + '/' + traducciones.size + ' traducciones dentro, ' +
    restos.length + ' sin aplicar, ' + original.length + ' -> ' + resultado.buffer.length + ' B');

  /*
   * Quedar cadenas sin aplicar es normal y no es un fallo. Parte del bytecode de
   * loader.swf esta ofuscado -- hay saltos que aterrizan dentro de un pool falso
   * y otros que salen del bloque -- y esos bloques se dejan intactos a proposito.
   * Son mensajes de arranque y avisos internos; la pantalla de conexion entra
   * entera. Fallo de verdad es que no entre nada.
   */
  if (restos.length) {
    console.log('  (bloques ofuscados, se dejan en frances: ' + JSON.stringify(restos.slice(0, 3)) + ')');
  }

  return puestas.length > 0;
}

/*
 * La guia del dresseur no es un SWF sino un .txt que el cliente lee tal cual, de
 * modo que aqui no hay bytecode que reescribir: se sustituye el archivo entero
 * por la version traducida. Lo que hay que respetar es su formato -- las marcas
 * ##pagina, %%item:id y los iconos son identificadores, no texto.
 */
const TEXTOS = [{ archivo: 'clips/pokefus/guide.txt', traducido: 'guide.es.txt' }];

function copiarTexto(objetivo) {
  const destino = path.join(RETROCLIENT, objetivo.archivo);
  const copia = path.join(BACKUP, objetivo.archivo);
  const traducido = path.join(__dirname, '..', 'tm', objetivo.traducido);

  fs.mkdirSync(path.dirname(copia), { recursive: true });

  if (copiaCaducada(destino, copia)) {
    fs.copyFileSync(destino, copia);
    console.log(objetivo.archivo + ': el juego se actualizo, copia del original rehecha');
  }

  /*
   * Lo mismo que con los SWF: si lo que hay ya es el archivo traducido, no
   * puede guardarse como copia del original, o "quitar traduccion" restauraria
   * el espanol y no habria vuelta atras.
   */
  if (!fs.existsSync(copia)) {
    if (fs.readFileSync(destino, 'utf8') === fs.readFileSync(traducido, 'utf8')) {
      console.log(objetivo.archivo + ': ya esta traducido y no hay copia del original.');
      console.log('   Abre el launcher de Pokefus una vez para que lo restaure, y vuelve a ejecutar.');
      return false;
    }

    fs.copyFileSync(destino, copia);
  }

  fs.copyFileSync(traducido, destino);
  fs.writeFileSync(copia + '.huella', huella(fs.readFileSync(destino)));

  const original = fs.readFileSync(copia, 'utf8');
  const nuevo = fs.readFileSync(destino, 'utf8');
  const paginas = (texto) => (texto.match(/^##[a-z]+\|/gm) || []).length;

  console.log(objetivo.archivo + ': ' + paginas(nuevo) + '/' + paginas(original) + ' paginas, ' +
    original.length + ' -> ' + nuevo.length + ' B');

  return paginas(nuevo) === paginas(original);
}

/*
 * config.xml no se parchea aqui: lo reescribe el hook al arrancar, porque el
 * puerto del proxy no se conoce hasta ese momento. Pero deshacer si es cosa de
 * este guion, o quedaria apuntando a un proxy que ya no existe.
 */
const SOLO_RESTAURAR = [
  { archivo: 'config.xml' },
  // Los nombres del mapa los pone src/hints.js, pero deshacer es de aqui.
  { archivo: 'clips/pokefus/worldmap/hints.js' },
];

function restaurar() {
  for (const objetivo of OBJETIVOS.concat(TEXTOS).concat(SOLO_RESTAURAR)) {
    const copia = path.join(BACKUP, objetivo.archivo);
    if (!fs.existsSync(copia)) { console.log(objetivo.archivo + ': sin copia'); continue; }
    fs.copyFileSync(copia, path.join(RETROCLIENT, objetivo.archivo));
    console.log(objetivo.archivo + ' restaurado');
  }
}

if (process.argv[2] === 'restaurar') {
  restaurar();
} else {
  const ok = OBJETIVOS.map(parchear).concat(TEXTOS.map(copiarTexto)).every(Boolean);
  process.exit(ok ? 0 : 1);
}
