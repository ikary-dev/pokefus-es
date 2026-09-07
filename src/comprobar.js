'use strict';

/*
 * Comprueba que traducir no altera la estructura de ningun mensaje.
 *
 * Se pasa por el traductor todo lo que haya en proxy.log -- trafico real del
 * servidor, grabado jugando -- y se compara antes y despues tres cosas: los
 * separadores, los numeros y el numero de campos.
 *
 * Los numeros importan tanto como el texto. El cliente saca de ahi los puntos
 * de vida, las posiciones y cuantos enemigos quedan en la reserva; cambiar uno
 * no se ve como un error de traduccion sino como un dato mal.
 *
 * Los escapes %XX se quitan antes de contar: sus digitos hexadecimales no son
 * numeros del protocolo, y como el espanol lleva enes y tildes, el recuento
 * cambia siempre sin que nada este mal.
 */

const fs = require('fs');
const path = require('path');
const { crearTraductor } = require('./proxy');

const RAIZ = path.join(__dirname, '..');

const sinEscapes = (texto) => texto.replace(/%[0-9A-Fa-f]{2}/g, ' ');
const numerosDe = (texto) => (sinEscapes(texto).match(/\d+/g) || []).join(',');
const veces = (texto, caracter) => texto.split(caracter).length;

const SEPARADORES = ['.', '|', ';', '~', ',', ':'];

/*
 * En el chat solo la barra parte el mensaje: el resto son signos de puntuacion
 * de la propia frase. Contarlos ahi daba un fallo donde no lo habia -- "La
 * respuesta es esta." tiene una coma menos que "La reponse, c'est ca." y eso es
 * exactamente lo que se pretendia.
 */
const TEXTO_LIBRE = /^cs|^cMK|<font/;
const SEPARADORES_LIBRES = ['|'];

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

function main() {
  const registro = path.join(RAIZ, 'proxy.log');
  if (!fs.existsSync(registro)) {
    console.log('No hay proxy.log. Crea tm/debug-proxy, juega un rato y vuelve.');
    return;
  }

  const leer = (archivo) => JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', archivo), 'utf8'));
  const traducir = crearTraductor(
    () => ({ frases: leer('server.json'), nombres: leerNombres(leer) }), null);

  const lineas = fs.readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  const fallos = { separadores: 0, numeros: 0 };
  let traducidos = 0;

  for (const linea of lineas) {
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch (error) { continue; }

    const salida = traducir(mensaje);
    if (salida !== mensaje) traducidos++;

    if (numerosDe(mensaje) !== numerosDe(salida)) {
      if (fallos.numeros < 3) {
        console.log('NUMEROS ALTERADOS');
        console.log('  antes: ' + mensaje.slice(0, 150));
        console.log('  ahora: ' + salida.slice(0, 150));
      }
      fallos.numeros++;
      continue;
    }

    for (const separador of (TEXTO_LIBRE.test(mensaje) ? SEPARADORES_LIBRES : SEPARADORES)) {
      if (veces(mensaje, separador) === veces(salida, separador)) continue;

      if (fallos.separadores < 3) {
        console.log('SEPARADOR "' + separador + '" ALTERADO');
        console.log('  antes: ' + mensaje.slice(0, 150));
        console.log('  ahora: ' + salida.slice(0, 150));
      }
      fallos.separadores++;
      break;
    }
  }

  console.log('\n' + lineas.length + ' mensajes reales | ' + traducidos + ' traducidos');
  console.log('separadores alterados: ' + fallos.separadores);
  console.log('numeros alterados:     ' + fallos.numeros);

  if (fallos.separadores || fallos.numeros) process.exit(1);
}

main();
