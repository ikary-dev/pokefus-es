'use strict';

/*
 * Comprueba que los nombres propios se llamen igual en todas partes.
 *
 * Es el fallo de calidad que mas molesta al jugar y el que menos se nota
 * leyendo: la mision dice "Traer 4 Espina del Campo Campo" y en la mochila el
 * objeto se llama "Espina del champi champ". El jugador busca algo que, para
 * el, no existe.
 *
 * Pasa porque el texto lo escribi yo y los nombres salen del archivo espanol
 * del juego. Cada uno por su lado esta bien; juntos no cuadran.
 *
 * Como se comprueba: si la frase francesa contiene un nombre que el juego ya
 * traduce de una manera concreta, la traduccion tiene que usar ESA manera.
 *
 *   node src/revisar-nombres.js
 */

const fs = require('fs');
const path = require('path');

const TM = path.join(__dirname, '..', 'tm');

/* Lo escrito a mano: es lo unico que puede desviarse del nombre oficial. */
const MIOS = ['server-manual.json', 'core.json', 'translations.json'];

const leer = (nombre) => {
  const ruta = path.join(TM, nombre);
  return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : {};
};

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function* entradas() {
  for (const archivo of MIOS) {
    const datos = leer(archivo);

    if (archivo === 'translations.json') {
      for (const [nombre, tabla] of Object.entries(datos.files || {})) {
        for (const [frances, espanol] of Object.entries(tabla)) {
          yield { archivo: archivo + ':' + nombre, frances, espanol };
        }
      }
      continue;
    }

    for (const [frances, espanol] of Object.entries(datos)) {
      if (typeof espanol === 'string') yield { archivo, frances, espanol };
    }
  }
}

function main() {
  /*
   * La autoridad no es solo el archivo del juego: los nombres de PNJ y de
   * objeto que traduje yo tambien mandan. Si en la lista de personajes pone
   * "Polvo Margen", la mision no puede decir "Poussiere Marge".
   */
  const traducciones = leer('translations.json').files || {};
  const oficiales = Object.assign(
    {},
    leer('nombres-fr-es.json'),
    traducciones.npc, traducciones.monsters, traducciones.items, traducciones.maps,
    leer('nombres-manual.json'));

  /*
   * Solo nombres largos y con mayuscula: los cortos y en minuscula son palabras
   * corrientes y aparecerian en cualquier frase por casualidad.
   *
   * Con una excepcion: los nombres muy largos valen aunque empiecen en
   * minuscula. El diccionario del juego guarda las dos formas -- "Vallee de la
   * Morh'Kitu" y "la vallee de la Morh'Kitu" -- y dentro de una frase solo casa
   * la segunda. Por exigir la mayuscula se colo "el valle de la Morh'Kitu" en
   * cinco misiones, cuando el mapa lo llama "Valle de la Muertekemata".
   */
  const candidatos = Object.entries(oficiales)
    .filter(([fr, es]) => fr !== es &&
      ((fr.length >= 9 && /^[A-ZÀ-Ÿ]/.test(fr)) || fr.length >= 14))
    .sort((a, b) => b[0].length - a[0].length);

  const avisos = [];

  for (const entrada of entradas()) {
    if (entrada.frances.length < 12) continue;

    /*
     * Los nombres que ya cuadran. Sirven para no avisar de un nombre corto que
     * vive dentro de uno largo: en "Le Village d'Aerdala" tambien esta "le
     * village", y el juego traduce el largo por "Airedala" y el corto por "el
     * Pueblo". Traducido el largo, el corto ya no pinta nada.
     */
    const cumplidos = [];

    for (const [fr, es] of candidatos) {
      if (entrada.frances.indexOf(fr) === -1) continue;

      /*
       * El nombre oficial puede traer articulo pegado ("el Valle de la
       * Muertekemata") y en la frase ir contraido ("al Valle de..."). Se compara
       * sin el articulo para no dar por malo lo que esta bien.
       */
      const desnudo = sinAcentos(es).replace(/^(el|la|los|las)\s+/, '');

      /*
       * Antes se cortaba aqui con un break, asi que una frase con dos nombres
       * -- uno bien y otro mal -- se daba por buena en cuanto encontraba el
       * bueno. Ahora se sigue mirando el resto.
       */
      if (sinAcentos(entrada.espanol).indexOf(desnudo) !== -1) { cumplidos.push(fr); continue; }

      if (cumplidos.some((largo) => largo.length > fr.length &&
        sinAcentos(largo).indexOf(sinAcentos(fr)) !== -1)) continue;

      avisos.push({ ...entrada, nombreFr: fr, nombreEs: es });
      break;   // con el primer fallo basta para revisar la frase
    }
  }

  console.log(avisos.length + ' frases donde el nombre no coincide con el del juego\n');

  for (const a of avisos) {
    console.log('  [' + a.archivo + ']  el juego lo llama "' + a.nombreEs + '"');
    console.log('     fr: ' + a.frances.slice(0, 110));
    console.log('     es: ' + a.espanol.slice(0, 110));
  }
}

main();
