'use strict';

/*
 * Revisa el texto YA PEGADO, no trozo a trozo.
 *
 * Los dialogos vienen partidos y yo los traduzco por partes. Cada parte puede
 * estar bien y el parrafo entero estar mal, porque el fallo esta en la costura:
 *
 *   "Toi, ce " + "matin, tu étais le quatrième."
 *   "Tú, eso " + "mañana, tú eras el cuarto."     <- "ce matin" partido en dos
 *
 * Leyendo el diccionario eso no se ve: hay que pegar los trozos en el mismo
 * orden en que los pega el juego y leer el resultado.
 *
 * Busca lo que delata una costura mal cosida:
 *
 *   frances     una palabra francesa que sobrevivio al corte
 *   repetida    la misma palabra dos veces seguidas ("tú tú", "de de")
 *   pegado      dos palabras sin espacio en medio
 *   articulos   dos articulos seguidos ("el la", "de el")
 *
 *   node src/revisar-costuras.js
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const { resolvePushedStrings } = require('./resolve');

const FRANCES = new RegExp(
  '(^|[^A-Za-zÀ-ÿ])(vous|votre|nous|notre|elles|qui|cette|aux|leur|dans|pour|avec|est|sont|une|du|toujours|jamais|aucune|chaque|apres|avant|depuis|sans|chez|ainsi|dont|alors|donc|elle|ils|encore|rien|autre|vers|puis|ce|ces|matin|soir|jour)([^A-Za-zÀ-ÿ]|$)');

const ESPANOL_QUE_LO_PARECE = /(^|[^a-zá-úA-ZÁ-Ú])(la|lo|le|los|me|te|se|nos) une([^a-zá-úA-ZÁ-Ú]|$)/i;

const REPETIDA = /\b([a-záéíóúñ]{2,})\s+\1\b/i;
/*
 * (Se probo una regla para "no se no" con una palabra en medio y se quito:
 * marcaba como error espanol correcto como "los que los" o "de lo de", y el
 * ruido tapaba los avisos buenos.)
 */
const REPETIDA_LEJOS = /\b([a-záéíóúñ]{2,4})\s+[a-záéíóúñ]{1,3}\s+\1\b/i;

const DOS_ARTICULOS = /\b(el|la|los|las|un|una)\s+(el|la|los|las|un|una)\b/i;
const PEGADO = /[a-zá-ú]{3}[A-ZÁ-Ú][a-zá-ú]{2}/;

/*
 * Genero cruzado en la costura. El frances trata a las criaturas en femenino
 * ("Sors-les toutes") y al partir la frase se cuela un "todas" detras de un
 * "Sacalos". Cada mitad parece correcta; juntas no concuerdan.
 */
const DESACUERDO =
  /\b(los|sácalos|míralos|cógelos|llévalos|ellos)\b[^.!?]{0,25}\b(todas|ellas|algunas|muchas)\b|\b(las|sácalas|míralas|ellas)\b[^.!?]{0,25}\b(todos|ellos|algunos|muchos)\b/i;

function ultimoArchivo(prefijo) {
  const cache = path.join(RAIZ, 'cache');
  return fs.readdirSync(cache)
    .filter((f) => f.indexOf(prefijo) === 0)
    .sort((a, b) => Number(a.split('_').pop().replace('.swf', '')) -
      Number(b.split('_').pop().replace('.swf', '')))
    .pop();
}

function main() {
  const traducciones = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'tm', 'translations.json'), 'utf8')).files || {};

  const avisos = [];

  for (const archivo of ['dialog', 'quests', 'classes']) {
    const tabla = traducciones[archivo];
    if (!tabla) continue;

    const swf = ultimoArchivo(archivo + '_fr_');
    if (!swf) continue;

    const cadenas = resolvePushedStrings(fs.readFileSync(path.join(RAIZ, 'cache', swf)), false);

    /* Trozos seguidos que estan los dos en el diccionario: eso es un parrafo. */
    const grupos = [];
    let grupo = [];

    for (const cadena of cadenas) {
      const traducible = typeof cadena === 'string' &&
        Object.prototype.hasOwnProperty.call(tabla, cadena);

      if (traducible) grupo.push(cadena);
      else if (grupo.length) { grupos.push(grupo); grupo = []; }
    }

    if (grupo.length) grupos.push(grupo);

    for (const trozos of grupos) {
      if (trozos.length < 2) continue;   // de una pieza no hay costura

      const pegado = trozos.map((t) => tabla[t]).join('');
      const problemas = [];

      if (FRANCES.test(pegado) && !ESPANOL_QUE_LO_PARECE.test(pegado)) problemas.push('frances');
      if (REPETIDA.test(pegado)) problemas.push('palabra repetida');
      if (DOS_ARTICULOS.test(pegado)) problemas.push('dos articulos seguidos');
      if (PEGADO.test(pegado)) problemas.push('palabras pegadas');
      if (DESACUERDO.test(pegado)) problemas.push('genero o numero cruzado');

      /*
       * Dos aperturas seguidas sin cierre en medio: la pregunta empezaba en un
       * trozo y el siguiente volvia a abrirla. Salia "¿Entiendes lo que ¿que
       * quiere decir?".
       */
      if (/[¿¡][^?!]{0,80}[¿¡]/.test(pegado)) problemas.push('abre dos veces');

      /*
       * Minuscula justo despues de un punto. Pasa cuando el corte cae entre la
       * frase y la siguiente: cada trozo empieza como si fuera continuacion, y
       * al pegarlos queda "...la misma compuerta. no se hace pasar...".
       */
      if (/[.!?] +[a-záéíóúñ]/.test(pegado)) problemas.push('minuscula tras punto');

      if (problemas.length) avisos.push({ archivo, problemas, pegado, trozos });
    }
  }

  console.log(avisos.length + ' parrafos con la costura sospechosa\n');

  for (const aviso of avisos) {
    console.log('  [' + aviso.archivo + ']  ' + aviso.problemas.join(', '));
    console.log('     ' + aviso.pegado.replace(/\n/g, ' ').slice(0, 200));
  }
}

main();
