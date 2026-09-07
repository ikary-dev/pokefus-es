'use strict';

/*
 * Que queda sin traducir, en las cuatro capas a la vez.
 *
 * El texto del juego no vive en un sitio: unas cosas estan en los archivos de
 * idioma que sirve Pokefus, otras dentro del cliente, otras las manda el
 * servidor en cada partida y otras las dibuja Electron en HTML. Hasta ahora
 * cada capa se revisaba por su lado y con un comando distinto, asi que era
 * facil dar por terminada una y olvidar otra.
 *
 * Esto las junta en un solo informe:
 *
 *   archivos de idioma  lo que Pokefus dejo en frances en su propio archivo
 *                       espanol (sale de comparar los dos idiomas)
 *   cliente             cadenas francesas dentro de loader.swf y core.swf que
 *                       no estan en sus diccionarios
 *   servidor            todo lo del trafico grabado que, despues de traducir,
 *                       sigue teniendo marcas de frances
 *   HTML                lo que el traductor de la pagina apunto sin saber
 *
 *   node src/inventario.js          resumen
 *   node src/inventario.js todo     ademas, la lista entera
 */

const fs = require('fs');
const path = require('path');
const { resolvePushedStrings } = require('./resolve');
const { crearTraductor } = require('./proxy');

const RAIZ = path.join(__dirname, '..');
const TM = path.join(RAIZ, 'tm');

const FRANCES = /[àâçèêëîïôùûœ]|\b(vous|votre|nous|des|une|dans|avec|mais|donc|cette|aux|qui|elle|ses|son|sa|les|du|ne|se|au|ton|ta|tes|toi|cet|il|sont|avant|même|depuis|encore|toujours|jamais|rien|est|sur|pas|pour|plus|que|ce|je|tu|le|la|et|ici|leur|aucun|aucune|chaque)\b/;
/*
 * loader.swf lleva dentro los mensajes en TODOS los idiomas del cliente, asi
 * que el detector de frances se llenaba de portugues, italiano y aleman --
 * "Atualizacao disponivel", "Modalita debug attiva" -- que no se ven nunca. Se
 * descartan por sus palabras propias.
 */
const OTRO_IDIOMA = /\b(atualiza|arquivo|voce|você|precisa|configuração|não|são|clique|soluções|aqui|para|versão|servidor não|modalità|impossibile|collegarsi|vedere|soluzioni|svuotare|della|wird|höher|benötigt|aktuelle|kopiëren|bestand|niet|gegevens)\b/i;

const ESPANOL = /[ñ¿¡]|\b(los|las|del|con|para|por|más|pero|desde|hasta|cuando|donde|este|esta|tus|sus|muy|todo|puedes|tiene|hacia|entre|una|ya|está|están|sin|nivel|criatura|hechizo|lo|se|en|el|de|tu)\b/;

const leerJson = (nombre) => {
  const ruta = path.join(TM, nombre);
  return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
};

/* --- capa 1: lo que ya calcula pendientes.js ------------------------------ */
function archivosDeIdioma() {
  const pendientes = leerJson('pendientes.json');
  const salida = [];

  for (const [archivo, lista] of Object.entries(pendientes)) {
    for (const cadena of lista) {
      if (!FRANCES.test(cadena)) continue;   // el resto son nombres propios
      salida.push(archivo + ': ' + cadena);
    }
  }

  return salida;
}

/* --- capa 2: cadenas francesas del cliente sin diccionario ---------------- */
function cliente() {
  const objetivos = [
    ['backup/loader.swf', 'loader.json'],
    ['backup/modules/core.swf', 'core.json'],
  ];

  const salida = [];

  for (const [swf, diccionario] of objetivos) {
    const ruta = path.join(RAIZ, swf);
    if (!fs.existsSync(ruta)) continue;

    const tabla = leerJson(diccionario);
    const vistas = new Set();

    for (const cadena of resolvePushedStrings(fs.readFileSync(ruta), false)) {
      if (typeof cadena !== 'string' || cadena.length < 6 || cadena.length > 200) continue;
      if (vistas.has(cadena) || Object.prototype.hasOwnProperty.call(tabla, cadena)) continue;
      if (!FRANCES.test(cadena) || !/[a-zà-ÿ]{3}/.test(cadena)) continue;
      if (OTRO_IDIOMA.test(cadena) || ESPANOL.test(cadena)) continue;
      /*
       * Se descartan los identificadores del codigo, pero SOLO los que se
       * escriben como tales: en minuscula o camelCase. Antes se descartaba
       * cualquier palabra suelta, y con eso se escondieron los botones
       * PROGRESSION, REJOINDRE y REFUSER, que llevaban meses en frances a la
       * vista de todos sin aparecer en ninguna lista.
       */
      if (/^[a-z_][a-zA-Z0-9_]*$/.test(cadena)) continue;

      vistas.add(cadena);
      salida.push(path.basename(swf) + ': ' + cadena);
    }
  }

  return salida;
}

/* --- capa 3: el trafico grabado, ya traducido ----------------------------- */
function servidor() {
  const registro = path.join(RAIZ, 'proxy.log');
  if (!fs.existsSync(registro)) return [];

  const traducir = crearTraductor(() => ({
    frases: leerJson('server.json'),
    nombres: Object.assign(leerJson('nombres-fr-es.json'), leerJson('nombres-manual.json')),
  }), null);

  const vistas = new Set();
  const salida = [];

  for (const linea of fs.readFileSync(registro, 'utf8').split('\n')) {
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch (error) { continue; }

    let texto = traducir(mensaje);
    try { texto = decodeURIComponent(texto); } catch (error) { /* se queda como esta */ }

    for (const trozo of texto.split(/[|~;]|<[^>]+>/)) {
      const limpio = trozo.trim();
      if (limpio.length < 12 || vistas.has(limpio)) continue;

      // Si ya tiene marcas de espanol es que se tradujo: lo que queda es
      // puntuacion o un nombre propio, y avisar de eso enterraria lo demas.
      if (!FRANCES.test(limpio) || ESPANOL.test(limpio)) continue;

      vistas.add(limpio);
      salida.push(limpio);
    }
  }

  return salida;
}

/* --- capa 4: lo que apunto el traductor de la pagina ---------------------- */
function html() {
  const desconocidas = leerJson('dom-desconocidas.json');
  const lista = Array.isArray(desconocidas) ? desconocidas : Object.keys(desconocidas);
  return lista.filter((cadena) => FRANCES.test(cadena));
}

function main() {
  const todo = process.argv[2] === 'todo';

  const capas = [
    ['archivos de idioma', archivosDeIdioma()],
    ['cliente (swf)', cliente()],
    ['servidor', servidor()],
    ['HTML', html()],
  ];

  let total = 0;

  for (const [nombre, lista] of capas) {
    total += lista.length;
    console.log(nombre.padEnd(22) + String(lista.length).padStart(5) + ' sin traducir');

    const muestra = todo ? lista : lista.slice(0, 8);
    for (const cadena of muestra) console.log('    ' + JSON.stringify(cadena).slice(0, 130));
    if (!todo && lista.length > muestra.length) console.log('    ... y ' + (lista.length - muestra.length) + ' mas');
  }

  console.log('\nTOTAL: ' + total);
}

main();
