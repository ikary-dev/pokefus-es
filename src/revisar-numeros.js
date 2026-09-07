'use strict';

/*
 * Comprueba que las cantidades digan lo mismo en frances y en espanol.
 *
 * comprobar.js ya vigila los numeros del protocolo, pero solo los que van en
 * cifras y solo en los mensajes del servidor. En los dialogos y en las misiones
 * las cantidades van escritas con letra -- "six pattes", "onze ans", "cinq
 * fibres" -- y ahi un despiste no rompe nada: simplemente el juego te miente.
 *
 * Salio leyendo: "des traces qui partent à SIX pattes" estaba traducido como
 * "huellas que salen a CUATRO patas". La frase se lee perfecta y el dato es
 * falso, que es la peor combinacion posible.
 *
 *   node src/revisar-numeros.js
 */

const fs = require('fs');
const path = require('path');

const TM = path.join(__dirname, '..', 'tm');

const NUMEROS = {
  /* "un" y "une" quedan fuera: aparecen dentro de "quelqu'un" y "aucune", y el
   * espanol los omite con toda la razon ("un autre jour" -> "otro dia"). Con
   * ellos dentro el informe era casi todo ruido. */
  deux: 'dos', trois: 'tres', quatre: 'cuatro', cinq: 'cinco',
  six: 'seis', sept: 'siete', huit: 'ocho', neuf: 'nueve', dix: 'diez',
  onze: 'once', douze: 'doce', treize: 'trece', quatorze: 'catorce', quinze: 'quince',
  seize: 'dieciseis', vingt: 'veinte', trente: 'treinta', quarante: 'cuarenta',
  cinquante: 'cincuenta', soixante: 'sesenta', cent: 'cien', mille: 'mil',
};

/* Las formas espanolas que valen por cada numero frances. */
const EQUIVALENTES = {
  un: ['un', 'una', 'uno'],
  dos: ['dos'], tres: ['tres'], cuatro: ['cuatro'], cinco: ['cinco'],
  seis: ['seis'], siete: ['siete'], ocho: ['ocho'], nueve: ['nueve'], diez: ['diez'],
  once: ['once'], doce: ['doce'], trece: ['trece'], catorce: ['catorce'], quince: ['quince'],
  dieciseis: ['dieciséis', 'dieciseis'], veinte: ['veinte', 'veinti'],
  treinta: ['treinta'], cuarenta: ['cuarenta'], cincuenta: ['cincuenta'],
  sesenta: ['sesenta'], cien: ['cien', 'ciento'], mil: ['mil'],
};

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function cifras(texto) {
  return (texto.match(/\d+/g) || []).join(',');
}

function palabrasNumero(texto, tabla) {
  const encontradas = [];
  const llano = sinAcentos(texto);

  for (const palabra of Object.keys(tabla)) {
    /*
     * Cuidado con dos trampas del frances: "neuf" tambien significa "nuevo"
     * ("rien de neuf" = "nada nuevo"), y los compuestos con guion ("dix-neuf")
     * no son dos numeros sino uno. Con eso dentro, cinco de siete avisos eran
     * falsos.
     */
    const patron = new RegExp('(^|[^a-z-])' + palabra + '([^a-z-]|$)', 'g');
    let m;
    while ((m = patron.exec(llano)) !== null) encontradas.push(palabra);
  }

  return encontradas;
}

function* entradas() {
  for (const archivo of ['translations.json', 'core.json', 'server-manual.json']) {
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
  const avisos = [];

  for (const e of entradas()) {
    if (cifras(e.frances) !== cifras(e.espanol)) {
      avisos.push({ ...e, motivo: 'las cifras no coinciden' });
      continue;
    }

    const enFrances = palabrasNumero(e.frances, NUMEROS);
    if (!enFrances.length) continue;

    const llanoEs = sinAcentos(e.espanol);

    for (const numero of enFrances) {
      const esperado = EQUIVALENTES[NUMEROS[numero]] || [];
      const esta = esperado.some((forma) => llanoEs.indexOf(sinAcentos(forma)) !== -1);

      // El numero puede haberse escrito en cifra, o la frase estar partida.
      if (esta || /\d/.test(e.espanol)) continue;

      avisos.push({ ...e, motivo: '"' + numero + '" (' + NUMEROS[numero] + ') no aparece' });
      break;
    }
  }

  console.log(avisos.length + ' cantidades que no cuadran\n');

  for (const a of avisos) {
    console.log('  [' + a.archivo + ']  ' + a.motivo);
    console.log('     fr: ' + a.frances.replace(/\n/g, ' ').slice(0, 120));
    console.log('     es: ' + a.espanol.replace(/\n/g, ' ').slice(0, 120));
  }
}

main();
