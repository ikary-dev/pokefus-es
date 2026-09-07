'use strict';

/*
 * Revisa la CALIDAD del espanol, no la mecanica.
 *
 * Las otras comprobaciones miran que no se rompa nada: separadores, numeros,
 * claves. Esta mira lo otro, que es lo que de verdad lee el jugador: que la
 * frase este bien escrita.
 *
 * Busca cosas que se pueden afirmar sin interpretar:
 *
 *   frances suelto     palabras que se quedaron sin traducir dentro de la frase
 *   espacio antes de : el frances lo pone, el espanol no
 *   falta ¿ o ¡        en espanol la pregunta y la exclamacion abren
 *   de el / a el       tienen que ser "del" y "al"
 *   coma antes de y    no va en una enumeracion normal
 *   doble espacio      resto de un reemplazo
 *   mayuscula rara     nombre propio en mitad de la frase por arrastre del frances
 *
 * No corrige nada: senala. Cada aviso hay que mirarlo, porque alguno sera
 * legitimo -- una coma antes de "y" puede estar bien si separa dos oraciones.
 *
 *   node src/revisar-estilo.js            resumen por tipo
 *   node src/revisar-estilo.js <tipo>     todos los de ese tipo
 */

const fs = require('fs');
const path = require('path');

const TM = path.join(__dirname, '..', 'tm');

/* Solo lo escrito a mano. El resto sale de los archivos oficiales del juego. */
const MIOS = [
  'server-manual.json',
  'core.json',
  'loader.json',
  'dom.json',
  'dom-fragmentos.json',
  'regiones.json',
  'nombres-manual.json',
  'hints.json',
  'translations.json',
];

/* Palabras que en espanol no existen y delatan un trozo sin traducir. */
const FRANCES = /\b(le|la|les|des|du|une|un|est|sont|dans|pour|avec|sur|par|qui|que|ne|pas|plus|tout|tous|cette|aux|leur|vous|votre|nous|notre|ils|elle|elles|il|je|tu|te|toi|ce|ces|cet|se|sa|ses|son|mais|donc|alors|quand|comme|bien|tres|tres|deja|encore|jamais|rien|aucun|aucune|chaque|autre|meme|apres|avant|depuis|sans|sous|entre|vers|chez|puis|ainsi|dont|ou)\b/;

/*
 * "la", "un", "una", "des"... existen tambien en espanol o en nombres propios,
 * asi que se exige mas de una palabra francesa seguida, o una inequivoca.
 */
/*
 * Fuera las que tambien son espanolas: "que", "sur" (el punto cardinal), "par",
 * "bien", "pas", "tres", "deja" y "les". Con ellas dentro el revisor marcaba como
 * sospechosas casi setecientas frases correctas, y un informe asi no se lee: lo
 * que de verdad esta mal se pierde entre el ruido.
 *
 * Y el limite de palabra no puede ser \b, porque para JavaScript una vocal
 * acentuada no es letra: "est" casaba dentro de "está" y "des" dentro de
 * "después". Se exige a los lados algo que no sea letra, tildes incluidas.
 */
const PALABRAS_FRANCESAS = 'vous|votre|nous|notre|elles|qui|cette|aux|leur|dans|pour|avec|est|sont|une|du|toujours|jamais|aucune|chaque|apres|avant|depuis|sans|chez|ainsi|dont|alors|donc|elle|ils|encore|rien|autre|vers|puis';

const FRANCES_SEGURO = new RegExp(
  '(^|[^A-Za-zÀ-ÿ])(' + PALABRAS_FRANCESAS + ')([^A-Za-zÀ-ÿ]|$)');

const REGLAS = [
  {
    tipo: 'frances',
    explica: 'trozo sin traducir dentro de una frase en espanol',
    prueba: (texto) => {
      if (!/[ñáéíóúü¿¡]/.test(texto) && !/\b(el|los|las|con|para|por|una|que|del|más)\b/.test(texto)) return false;
      const palabras = texto.toLowerCase().match(FRANCES_SEGURO);
      return Boolean(palabras);
    },
  },
  {
    tipo: 'espacio-puntuacion',
    explica: 'espacio antes de : ; ! ? — eso es frances',
    prueba: (texto) => / [:;!?](\s|$)/.test(texto),
  },
  {
    tipo: 'abre-interrogacion',
    explica: 'pregunta o exclamacion sin abrir',
    prueba: (texto) => {
      const cierra = (texto.match(/[?!]/g) || []).length;
      const abre = (texto.match(/[¿¡]/g) || []).length;
      return cierra > abre;
    },
  },
  {
    tipo: 'de-el',
    explica: '"de el" / "a el" deberian ser "del" / "al"',
    prueba: (texto) => /\b(de|a) el\b/.test(texto) && !/\bel\b [A-ZÀ-Ÿ]/.test(texto),
  },
  {
    tipo: 'coma-y',
    explica: 'coma antes de "y" (revisar: a veces es correcta)',
    prueba: (texto) => /, y\b/.test(texto),
  },
  {
    tipo: 'doble-espacio',
    explica: 'dos espacios seguidos o espacio antes de coma o punto',
    prueba: (texto) => /\S  \S/.test(texto) || / [,.](\s|$)/.test(texto),
  },
];

function* entradas() {
  for (const archivo of MIOS) {
    const ruta = path.join(TM, archivo);
    if (!fs.existsSync(ruta)) continue;

    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));

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
  const pedido = process.argv[2];
  const porTipo = new Map();

  for (const entrada of entradas()) {
    for (const regla of REGLAS) {
      if (!regla.prueba(entrada.espanol)) continue;
      if (!porTipo.has(regla.tipo)) porTipo.set(regla.tipo, []);
      porTipo.get(regla.tipo).push(entrada);
    }
  }

  if (!pedido) {
    console.log('avisos de estilo:\n');
    for (const regla of REGLAS) {
      const lista = porTipo.get(regla.tipo) || [];
      console.log('  ' + regla.tipo.padEnd(20) + String(lista.length).padStart(5) + '   ' + regla.explica);
    }
    console.log('\nnode src/revisar-estilo.js <tipo>   para verlos');
    return;
  }

  const lista = porTipo.get(pedido) || [];
  console.log(lista.length + ' avisos de "' + pedido + '"\n');

  for (const e of lista) {
    console.log('  [' + e.archivo + ']');
    console.log('     fr: ' + JSON.stringify(e.frances).slice(0, 150));
    console.log('     es: ' + JSON.stringify(e.espanol).slice(0, 150));
  }
}

main();
