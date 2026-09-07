'use strict';

/*
 * Busca traducciones que cambien DATOS, no texto.
 *
 * comprobar.js ya vigila que no se altere la estructura: los separadores y los
 * numeros. Pero hay una forma de romper el cliente sin tocar ninguna de las dos
 * cosas: cambiar el VALOR de un campo que el cliente usa como clave. El mensaje
 * sigue teniendo la misma forma y pasa la comprobacion, y sin embargo el
 * cliente ya no reconoce lo que le llega.
 *
 * Ha pasado tres veces:
 *
 *   RESERVE -> RESERVA      el estado de un Dofemon en la reserva; el contador
 *                           de monstruos y el cambio de Dofemon dejaron de ir
 *   brakmar -> Brakmar      la clave de una zona
 *   garde   -> Guarda       un verbo que casaba con el nombre de un sitio
 *
 * Asi que esto compara cada mensaje grabado antes y despues de traducir y avisa
 * de todo campo cambiado que NO parezca texto de pantalla. El texto de pantalla
 * lleva espacios, mayuscula inicial o tildes; una clave no lleva nada de eso.
 *
 *   node src/auditar-proxy.js
 */

const fs = require('fs');
const path = require('path');
const { crearTraductor } = require('./proxy');

const RAIZ = path.join(__dirname, '..');

/* El mismo corte que usa el proxy, para comparar campo con campo. */
const CAMPOS = new RegExp("[|,~;]|(?<=[^ ]):(?=[^ ])");

const leer = (nombre) => JSON.parse(fs.readFileSync(path.join(RAIZ, 'tm', nombre), 'utf8'));
const descodificar = (texto) => {
  try { return decodeURIComponent(texto); } catch (error) { return texto; }
};

/*
 * Que aspecto tiene el texto que se lee en pantalla: varias palabras, o una
 * sola con mayuscula inicial o con tilde. Lo que no cumple nada de eso es una
 * clave, un estado o un identificador.
 */
function pareceTexto(campo) {
  if (campo.indexOf(' ') !== -1) return true;
  if (/[À-ÿ]/.test(campo)) return true;
  if (/^[A-ZÀ-Ÿ][a-zà-ÿ]{2,}$/.test(campo)) return true;
  return false;
}

function main() {
  const registro = path.join(RAIZ, 'proxy.log');
  if (!fs.existsSync(registro)) { console.log('no hay proxy.log'); return; }

  const traducir = crearTraductor(() => ({
    frases: leer('server.json'),
    nombres: Object.assign({}, leer('nombres-fr-es.json'), leer('nombres-manual.json')),
  }), null);

  const sospechas = new Map();
  let mensajes = 0;

  for (const linea of fs.readFileSync(registro, 'utf8').split('\n')) {
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch (error) { continue; }

    mensajes++;
    const salida = traducir(mensaje);
    if (salida === mensaje) continue;

    const antes = mensaje.split(CAMPOS).map(descodificar);
    const ahora = salida.split(CAMPOS).map(descodificar);

    for (let i = 0; i < antes.length; i++) {
      if (antes[i] === ahora[i] || ahora[i] === undefined) continue;
      if (pareceTexto(antes[i])) continue;

      const clave = antes[i] + ' -> ' + ahora[i];
      if (!sospechas.has(clave)) {
        sospechas.set(clave, { veces: 0, ejemplo: mensaje.slice(0, 90) });
      }
      sospechas.get(clave).veces++;
    }
  }

  console.log(mensajes + ' mensajes revisados');

  if (!sospechas.size) {
    console.log('\nNingun campo de datos alterado. Solo se ha tocado texto.');
    return;
  }

  console.log('\n' + sospechas.size + ' valores que NO parecen texto y aun asi cambian:\n');
  for (const [cambio, dato] of [...sospechas].sort((a, b) => b[1].veces - a[1].veces)) {
    console.log('  ' + String(dato.veces).padStart(6) + '  ' + cambio);
    console.log('          en: ' + dato.ejemplo);
  }

  process.exit(1);
}

main();
