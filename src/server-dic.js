'use strict';

/*
 * Arma el diccionario que usa el proxy.
 *
 * El servidor repite por el socket nombres y frases que ya estan traducidos en
 * otra parte: hechizos, objetos, vocaciones, titulos de mision. En vez de
 * escribirlos otra vez a mano se juntan todos los diccionarios que ya existen y
 * se les anade lo que solo dice el servidor -- temperamentos, talentos, vinculo
 * -- que vive en server-manual.json.
 *
 * Se rehace con un comando, asi que traducir algo una vez lo deja traducido en
 * todas partes.
 *
 * Se probo tambien a sacar parejas frances-espanol alineando los archivos de
 * idioma de los dos idiomas. Se descarto: en los archivos grandes las dos
 * secuencias se desincronizan y salian parejas falsas del tipo "Petit Bouftou"
 * contra "Thanos". Una pareja de menos no cuesta nada; una falsa cambia una
 * palabra por otra que no tiene nada que ver.
 */

const fs = require('fs');
const path = require('path');

const TM = path.join(__dirname, '..', 'tm');

function leer(nombre) {
  const ruta = path.join(TM, nombre);
  return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
}

/* Muy corto es peligroso: "Or" o "Cap" aparecerian dentro de otras palabras. */
const MINIMO = 3;

function main() {
  const diccionario = {};
  let fuentes = 0;

  /*
   * Una etiqueta corta de una sola palabra vale dentro de un SWF, donde cada
   * cadena es una unidad, pero en el socket se busca como subcadena y parte
   * palabras: "Terre" convertia "Armure Terrestre" en "Armure Tierrastre". De
   * los diccionarios de interfaz solo pasan las entradas largas o de varias
   * palabras.
   */
  const SOLO_LARGAS = new Set(['core.json', 'loader.json', 'dom.json']);
  const LARGO_MINIMO_SUELTA = 7;

  /*
   * Piezas que el cliente va juntando y que en el socket hacen estragos.
   *
   * Dentro del SWF cada una es un trozo de un texto que el codigo arma sobre la
   * marcha -- count + " haut" + "s" + " fait" + "s" da "3 hauts faits" -- y ahi
   * su traduccion es correcta. Pero en el socket se buscan como subcadena
   * dentro de frases enteras, y entonces:
   *
   *   " bete"     -> " bicho"     "ce n'était pas une bête sauvage"
   *                                  -> "... une bicho sauvage"
   *   " haut"     -> " hazaña"    "Le haut de l'Arbre Hakam"
   *                                  -> "Le hazaña de l'Arbre Hakam"
   *   " dresseur" -> " equipo"    "Un dresseur tient le sentier"
   *                                  -> "Un equipo tient le sentier"
   *   " sur "     -> " de "       "capturable sur cette case"
   *                                  -> "capturable de cette case"
   *
   * Se apartan una a una y no por regla general: casi todas las demas piezas
   * cortas (" tour", " points", "Page ") si valen en los dos sitios, y
   * apartarlas todas dejaba en frances lo que ya estaba bien.
   *
   * El caso de " sur " entre cifras -- "150 sur 150" -- lo resuelve un retoque
   * del proxy, que va pegado a los numeros y no toca ninguna frase.
   */
  const SOLO_PARA_EL_CLIENTE = new Set([' bete', ' betes', ' haut', ' dresseur', ' sur ', ' fait']);

  const anadir = function (tabla, origen) {
    let n = 0;
    for (const [frances, espanol] of Object.entries(tabla)) {
      if (!frances || !espanol || frances.length < MINIMO) continue;

      /* Da igual de que archivo venga: en el socket no entra. */
      if (SOLO_PARA_EL_CLIENTE.has(frances)) continue;

      if (SOLO_LARGAS.has(origen) &&
          frances.indexOf(' ') === -1 && frances.length < LARGO_MINIMO_SUELTA) continue;
      if (diccionario[frances]) continue;
      diccionario[frances] = espanol;
      n++;
    }
    console.log(origen.padEnd(22) + String(n).padStart(6) + ' entradas');
    fuentes++;
  };

  // El manual va primero: manda sobre lo demas si algo se repite.
  anadir(leer('server-manual.json'), 'server-manual.json');
  anadir(leer('server-capturado.json'), 'server-capturado.json');
  anadir(leer('server-capturado2.json'), 'server-capturado2.json');
  anadir(leer('server-capturado3.json'), 'server-capturado3.json');
  anadir(leer('server-capturado4.json'), 'server-capturado4.json');
  anadir(leer('server-capturado5.json'), 'server-capturado5.json');
  anadir(leer('server-capturado6.json'), 'server-capturado6.json');
  anadir(leer('core.json'), 'core.json');
  anadir(leer('loader.json'), 'loader.json');

  // Trozos de plantilla sacados del propio juego: su redaccion oficial.
  anadir(leer('plantillas-fr-es.json'), 'plantillas-fr-es.json');

  // Los nombres de region: el mismo archivo que usa la pagina para las
  // infobulbas del mapa, para que no se traduzcan de dos maneras distintas.
  anadir(leer('regiones.json'), 'regiones.json');

  const memoria = leer('translations.json');
  for (const archivo of Object.keys(memoria.files || {})) {
    anadir(memoria.files[archivo], 'translations/' + archivo);
  }

  fs.writeFileSync(path.join(TM, 'server.json'), JSON.stringify(diccionario, null, 1));
  console.log('\n' + Object.keys(diccionario).length + ' entradas de ' + fuentes + ' fuentes -> tm/server.json');
}

main();
