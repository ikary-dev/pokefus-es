'use strict';

/*
 * Punto de enganche dentro del cliente.
 *
 * Levanta el servidor local y desvia hacia el las peticiones de idioma. El
 * filtro es lo mas estrecho posible -- solo pokefus.org/client/lang/ -- porque
 * por esa misma sesion pasa todo lo demas que el juego descarga, y un filtro
 * ancho de mas convertiria un fallo de traduccion en un juego que no arranca.
 *
 * El registro va a un archivo: el juego corre sin consola visible, asi que un
 * console.log aqui no lo lee nadie.
 */

const fs = require('fs');
const path = require('path');
const electron = require('electron');

const RAIZ = path.join(__dirname, '..');
const REGISTRO = path.join(RAIZ, 'hook.log');
const FILTRO = ['https://pokefus.org/client/lang/*'];

function leerNombres(leer) {
  /*
   * Los nombres salen de los archivos del juego, y a veces salen a medias: el
   * emparejado por id daba "Cimetière" -> "El cementerio" y luego "le cimetière
   * primitif" quedaba como "El cementerio primitif". Encima va una capa escrita
   * a mano que manda sobre lo automatico, para corregir esos casos sin tocar lo
   * que se regenera en cada actualizacion.
   */
  return Object.assign(leer('nombres-fr-es.json'), leer('nombres-manual.json'));
}

function anotar(mensaje) {
  const linea = new Date().toISOString() + '  ' + mensaje + '\n';
  try { fs.appendFileSync(REGISTRO, linea); } catch (error) { /* nunca romper el juego por el log */ }
}

/*
 * El juego puede abrir sus ventanas en una particion propia. Electron 11 no
 * emite todavia 'session-created', asi que se envuelve la fabrica de sesiones
 * para no depender de cual acabe usando.
 */
function engancharTodasLasSesiones(aplicar) {
  aplicar(electron.session.defaultSession, 'defaultSession');

  const original = electron.session.fromPartition;
  electron.session.fromPartition = function (particion, opciones) {
    const sesion = original.call(electron.session, particion, opciones);
    aplicar(sesion, particion);
    return sesion;
  };
}

function instalar() {
  const { start } = require(path.join(RAIZ, 'src', 'server.js'));

  start(anotar).then(function (servicio) {
    anotar('servidor local en 127.0.0.1:' + servicio.port);

    const enganchadas = new WeakSet();

    engancharTodasLasSesiones(function (sesion, nombre) {
      if (!sesion || enganchadas.has(sesion)) return;
      enganchadas.add(sesion);

      sesion.webRequest.onBeforeRequest({ urls: FILTRO }, function (detalles, responder) {
        const url = new URL(detalles.url);
        const destino = 'http://127.0.0.1:' + servicio.port + url.pathname + url.search;
        anotar('desvio ' + url.pathname + url.search + ' -> :' + servicio.port);
        responder({ redirectURL: destino });
      });

      anotar('sesion enganchada: ' + nombre);
    });
  }).catch(function (error) {
    anotar('NO SE PUDO ARRANCAR: ' + error.message + '\n' + error.stack);
  });
}

/*
 * El texto que escribe el servidor -- temperamentos, talentos, vinculo, chat --
 * no esta en ningun archivo y no viaja por HTTP: llega por el socket del juego.
 * Se pone un proxy delante y se apunta el cliente hacia el reescribiendo
 * config.xml, que es donde el cliente lee la direccion del servidor.
 *
 * config.xml se reescribe SIEMPRE a partir de la copia original, y si el proxy
 * no arranca se restaura tal cual: mas vale el juego en frances que un cliente
 * que no conecta.
 */
const RETROCLIENT = require(path.join(RAIZ, 'src', 'instalacion.js')).retroclient();
const CONFIG = path.join(RETROCLIENT, 'config.xml');
const CONFIG_ORIGINAL = path.join(RAIZ, 'backup', 'config.xml');

function instalarProxy() {
  fs.mkdirSync(path.dirname(CONFIG_ORIGINAL), { recursive: true });
  if (!fs.existsSync(CONFIG_ORIGINAL)) fs.copyFileSync(CONFIG, CONFIG_ORIGINAL);

  const original = fs.readFileSync(CONFIG_ORIGINAL, 'utf8');
  const destino = /<connserver[^>]*ip="([^"]+)"[^>]*port="(\d+)"/.exec(original);

  if (!destino) {
    anotar('no se encuentra connserver en config.xml, el proxy se queda fuera');
    fs.copyFileSync(CONFIG_ORIGINAL, CONFIG);
    return;
  }

  const rendirse = function (motivo) {
    anotar('proxy desactivado (' + motivo + '), se conecta directo');
    try { fs.copyFileSync(CONFIG_ORIGINAL, CONFIG); } catch (error) { /* nada que hacer */ }
  };

  const pendientes = path.join(RAIZ, 'tm', 'server-desconocidas.json');
  const vistas = new Set(
    fs.existsSync(pendientes) ? JSON.parse(fs.readFileSync(pendientes, 'utf8')) : []);

  const apuntar = function (texto) {
    if (vistas.has(texto)) return;
    vistas.add(texto);
    try { fs.writeFileSync(pendientes, JSON.stringify([...vistas].sort(), null, 1)); } catch (e) { /* */ }
  };

  /*
   * Dos diccionarios con usos distintos: las frases se buscan dentro del texto
   * y los nombres -- catorce mil, sacados de los propios archivos del juego --
   * se consultan por coincidencia exacta del campo.
   */
  const leer = function (archivo) {
    try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', archivo), 'utf8')); }
    catch (error) { return {}; }
  };

  const cargar = function () {
    return { frases: leer('server.json'), nombres: leerNombres(leer) };
  };

  const { start } = require(path.join(RAIZ, 'src', 'proxy.js'));

  start(destino[1], Number(destino[2]), cargar, anotar, apuntar).then(function (servicio) {
    const parcheado = original
      .replace(/(<connserver[^>]*ip=")[^"]+(")/, '$1127.0.0.1$2')
      .replace(/(<connserver[^>]*port=")\d+(")/, '$1' + servicio.port + '$2');

    fs.writeFileSync(CONFIG, parcheado);
    anotar('proxy de juego: 127.0.0.1:' + servicio.port + ' -> ' + destino[1] + ':' + destino[2]);
  }).catch(function (error) { rendirse(error.message); });
}

/*
 * La capa HTML -- panel lateral, mapa, chat -- no pasa por la red, asi que el
 * desvio no la alcanza: se traduce dentro de cada ventana.
 *
 * Lo que el guion ve en frances y no sabe traducir se apunta aparte. Es lo que
 * hace que esto aguante las actualizaciones sin mantenimiento a ciegas: cuando
 * Pokefus anada una pantalla, su texto aparece solo en ese archivo.
 */
function instalarDom() {
  const { instalarEnVentana } = require(path.join(__dirname, 'dom-translate.js'));
  const diccionario = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', 'dom.json'), 'utf8'));
  /*
   * Las infobulbas del mapa arman su texto con el nombre de region que manda
   * el servidor, asi que la pagina necesita el mismo diccionario de regiones
   * que usa el proxy. Se le pasan como fragmentos, que es como se busca
   * dentro de un texto compuesto.
   */
  const rutaRegiones = path.join(RAIZ, 'tm', 'regiones.json');
  const regiones = fs.existsSync(rutaRegiones)
    ? JSON.parse(fs.readFileSync(rutaRegiones, 'utf8'))
    : {};

  const rutaFragmentos = path.join(RAIZ, 'tm', 'dom-fragmentos.json');
  const fragmentos = Object.assign({}, regiones, fs.existsSync(rutaFragmentos)
    ? JSON.parse(fs.readFileSync(rutaFragmentos, 'utf8'))
    : {});
  const pendientes = path.join(RAIZ, 'tm', 'dom-desconocidas.json');

  const vistas = new Set(
    fs.existsSync(pendientes) ? JSON.parse(fs.readFileSync(pendientes, 'utf8')) : []);

  const apuntar = function (texto) {
    if (vistas.has(texto)) return;
    vistas.add(texto);
    fs.writeFileSync(pendientes, JSON.stringify([...vistas].sort(), null, 1));
    anotar('sin traducir en DOM: ' + JSON.stringify(texto));
  };

  electron.app.on('web-contents-created', function (evento, contenido) {
    instalarEnVentana(contenido, diccionario, fragmentos, anotar, apuntar);
  });
}

try {
  anotar('--- arranque ---');

  // Antes de whenReady: las ventanas se crean nada mas estar listo, y
  // suscribirse despues perderia la primera, que es la del juego.
  instalarDom();
  instalarProxy();

  electron.app.whenReady().then(instalar).catch(function (error) {
    anotar('whenReady fallo: ' + error.message);
  });
} catch (error) {
  anotar('ERROR al enganchar: ' + error.message + '\n' + error.stack);
}
