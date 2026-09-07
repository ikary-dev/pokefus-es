'use strict';

/*
 * Servidor local que sirve los archivos de idioma ya traducidos.
 *
 * Corre dentro del propio proceso principal del juego. El hook redirige hacia
 * aqui las peticiones a pokefus.org/client/lang/, y solo esas: cualquier otra
 * cosa que el juego descargue -- mapas, retratos, sonidos -- sigue su camino
 * normal sin pasar por aqui.
 *
 * Se escribe para el Node que trae Electron 11, que es el 12: sin fetch global,
 * sin ?? y sin ?.
 */

const http = require('http');
const https = require('https');
const path = require('path');

const { repackLangSwf } = require('./repack');
const tm = require('./tm');

const ORIGIN = 'https://pokefus.org/client/';

/* La descarga del original se cachea en memoria: el juego pide cada archivo
 * una vez por arranque, pero el manifiesto puede pedirse varias. */
const downloads = new Map();

function download(url) {
  if (downloads.has(url)) return downloads.get(url);

  const pending = new Promise(function (resolve, reject) {
    https.get(url, function (response) {
      const chunks = [];
      response.on('data', function (chunk) { chunks.push(chunk); });
      response.on('end', function () {
        resolve({ status: response.statusCode, body: Buffer.concat(chunks) });
      });
    }).on('error', reject);
  });

  downloads.set(url, pending);
  return pending;
}

/*
 * El manifiesto llega como "&f=items,es,1180|dialog,es,1210|...". Se reescribe
 * la version de los archivos que sabemos traducir, y se deja intacto todo lo
 * demas: si manana Pokefus anade una entrada nueva, pasa sin tocar.
 */
function rewriteManifest(text, memory) {
  const prefix = text.startsWith('&f=') ? '&f=' : '';
  const body = prefix ? text.slice(3) : text;

  const rewritten = body.split('|').map(function (chunk) {
    const parts = chunk.split(',');
    if (parts.length !== 3) return chunk;

    const name = parts[0];
    const lang = parts[1];
    const version = parts[2];

    if (!memory.files[name]) return chunk;
    return [name, lang, tm.syntheticVersion(version, memory.revision)].join(',');
  });

  return prefix + rewritten.join('|');
}

/*
 * El origen es https://pokefus.org/client/, de modo que la ruta que llega
 * empieza por /client/. Se corta ese prefijo una sola vez y a partir de ahi
 * todo -- rutas y reenvio -- trabaja en relativo, sin volver a pegarlo.
 */
const PREFIJO = /^\/client\//;
const SWF_ROUTE = /^lang\/swf\/([A-Za-z]+)_([a-z]{2})_(\d+)\.swf$/;
const MANIFEST_ROUTE = /^lang\/versions_([a-z]{2})\.txt$/;

async function handle(request, response, log) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const ruta = url.pathname.replace(PREFIJO, '');
  const memory = tm.load();

  const manifest = MANIFEST_ROUTE.exec(ruta);
  if (manifest) {
    const original = await download(ORIGIN + 'lang/versions_' + manifest[1] + '.txt');
    const text = rewriteManifest(original.body.toString('utf8'), memory);

    log('manifiesto ' + manifest[1] + ' (revision ' + memory.revision + ')');
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(text);
    return;
  }

  const swf = SWF_ROUTE.exec(ruta);
  if (swf) {
    const name = swf[1];
    const lang = swf[2];

    /*
     * Por aqui pasan todos los archivos de idioma, no solo los que traducimos.
     * A los demas el manifiesto les deja su version original, asi que quitarles
     * los tres digitos de la revision los convertiria en una version que no
     * existe. Solo se decodifica lo que anunciamos como sintetico.
     */
    const traducido = Boolean(memory.files[name]);
    const real = traducido ? tm.realVersion(swf[3]) : swf[3];

    /*
     * EL CLIENTE PIDE TAMBIEN LOS ARCHIVOS FRANCESES, y los carga DESPUES de
     * los espanoles, de modo que los pisa: el archivo ES trae "Bandana Mokete"
     * con su descripcion en espanol y en pantalla salia "Bandana Troue". Ese
     * era el motivo de que medio juego siguiera en frances por mucho que se
     * tradujeran los archivos ES.
     *
     * Asi que cuando pide el frances se le sirve el contenido espanol. La
     * version es la misma en los dos idiomas, solo cambia la letra del nombre.
     */
    const origen = lang === 'fr' ? 'es' : lang;
    if (origen !== lang) log(name + ': pide ' + lang + ', se le da ' + origen);

    const descarga = await download(ORIGIN + 'lang/swf/' + name + '_' + origen + '_' + real + '.swf');

    if (descarga.status !== 200) {
      log(name + '_' + origen + '_' + real + ': el origen responde ' + descarga.status);
      response.writeHead(descarga.status);
      response.end(descarga.body);
      return;
    }

    const original = descarga.body;
    const translations = tm.translationsFor(memory, name);

    if (translations.size === 0) {
      log(name + ' sin traducciones, se sirve tal cual');
      response.writeHead(200, { 'Content-Type': 'application/x-shockwave-flash' });
      response.end(original);
      return;
    }

    /*
     * Con diagnostico: un bloque puede no caber y quedarse sin tocar. Si eso no
     * se dice, el registro canta las cadenas aplicadas mientras el archivo sale
     * en frances -- que es exactamente lo que paso con los dialogos.
     */
    const diag = {};
    const result = repackLangSwf(original, translations, { diag });

    const aviso = (diag.bloquesAbandonados ? '  BLOQUES SIN TRADUCIR: ' + diag.bloquesAbandonados : '') +
      ((diag.apartadasPorTamano || []).length
        ? '  ' + diag.apartadasPorTamano.length + ' apartadas por no caber' : '');

    log(name + '_' + lang + '_' + real + ' -> ' + result.applied.size + '/' + translations.size +
      ' cadenas, ' + result.rewritten + ' pushes, ' + original.length + ' -> ' + result.buffer.length + ' B' + aviso);

    response.writeHead(200, { 'Content-Type': 'application/x-shockwave-flash' });
    response.end(result.buffer);
    return;
  }

  /*
   * Cualquier otra cosa se reenvia sin tocar, estado incluido: el cliente
   * sondea rutas que no existen -- lang/versions.swf entre ellas -- y cuenta
   * con recibir el 404, no un error nuestro.
   */
  const passthrough = await download(ORIGIN + ruta + url.search);
  log('reenvio ' + ruta + ' -> ' + passthrough.status);
  response.writeHead(passthrough.status);
  response.end(passthrough.body);
}

function start(log) {
  const report = log || function () {};

  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (request, response) {
      handle(request, response, report).catch(function (error) {
        report('ERROR ' + request.url + ': ' + error.message);

        // Un fallo despues de haber empezado a responder ya no admite
        // cabeceras: solo queda cortar, y que el cliente lo trate como
        // descarga incompleta.
        if (response.headersSent) { response.destroy(); return; }

        response.writeHead(502);
        response.end(String(error.message));
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

module.exports = { start, rewriteManifest, ORIGIN };
