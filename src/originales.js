'use strict';

/*
 * Mantiene al dia las copias de los archivos del cliente que parcheamos.
 *
 * EL FALLO QUE ARREGLA
 *
 * La copia del original se hacia una sola vez, la primera, y no se volvia a
 * mirar. Mientras Pokefus no tocara esos archivos, bien. Pero el 3 de septiembre
 * la actualizacion trajo un core.swf nuevo -- con el relevo en combate, el dano
 * estimado y la caja de Dofemons -- y desde entonces cada arranque restauraba
 * encima la version del 2 y volvia a parchearla. El jugador perdio funciones
 * enteras sin que nada avisara: la traduccion se veia bien, y el juego era el de
 * la semana pasada.
 *
 * COMO SE DETECTA
 *
 * El propio launcher deja en "version.control" el manifiesto que aplico, con el
 * sha256 y el tamano de cada uno de los 23 750 archivos del cliente. Basta con
 * mirar ahi: si la copia que guardamos no coincide con el sha oficial, es que
 * esta caducada. Y como el manifiesto dice tambien de donde sale cada archivo,
 * se puede volver a bajar el original sin tocar el juego.
 *
 * No hace falta saber nada de versiones ni de fechas: o el sha cuadra o no.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const instalacion = require('./instalacion');

/* De donde sirve Pokefus los archivos del cliente. */
const CDN = 'https://cdn.pokefus.org/client/';

/* Dentro del manifiesto las rutas van relativas a la carpeta client/. */
const PREFIJO = 'resources/app/retroclient/';

const huella = (datos) => crypto.createHash('sha256').update(datos).digest('hex');
const normalizar = (ruta) => ruta.split('\\').join('/');

function leerManifiesto() {
  const ruta = path.join(instalacion.raizDelJuego(), 'version.control');
  if (!fs.existsSync(ruta)) return null;

  try {
    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return Array.isArray(datos.files) ? datos : null;
  } catch (error) {
    return null;   // manifiesto ilegible: se sigue con lo que haya
  }
}

function entradaDe(manifiesto, relativo) {
  const buscado = PREFIJO + relativo;
  return manifiesto.files.find((f) => normalizar(f.path) === buscado) || null;
}

async function bajar(relativo) {
  const respuesta = await fetch(CDN + PREFIJO + relativo);
  if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
  return Buffer.from(await respuesta.arrayBuffer());
}

/*
 * Deja en backup/ el original que corresponde a la version instalada.
 *
 * Devuelve la lista de los que ha tenido que renovar, para poder avisar: si un
 * archivo cambio, es probable que traiga texto nuevo sin traducir.
 */
async function ponerAlDia(relativos, carpetaBackup) {
  const manifiesto = leerManifiesto();
  if (!manifiesto) return { renovados: [], sinManifiesto: true };

  const renovados = [];

  for (const relativo of relativos) {
    const entrada = entradaDe(manifiesto, relativo);
    if (!entrada || !entrada.sha) continue;

    const copia = path.join(carpetaBackup, relativo);
    if (fs.existsSync(copia) && huella(fs.readFileSync(copia)) === entrada.sha) continue;

    // La copia no es la buena. Si el archivo que hay en el juego si lo es, se
    // usa ese y no se gasta red.
    const enJuego = path.join(instalacion.retroclient(), relativo);
    let contenido = null;

    if (fs.existsSync(enJuego) && huella(fs.readFileSync(enJuego)) === entrada.sha) {
      contenido = fs.readFileSync(enJuego);
    } else {
      try {
        const bajado = await bajar(relativo);
        if (huella(bajado) !== entrada.sha) throw new Error('el archivo bajado no cuadra con el manifiesto');
        contenido = bajado;
      } catch (error) {
        console.log('   ' + relativo + ': no se pudo renovar (' + error.message + ')');
        continue;
      }
    }

    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.writeFileSync(copia, contenido);

    // La huella que dejo el parche anterior ya no vale para nada.
    if (fs.existsSync(copia + '.huella')) fs.unlinkSync(copia + '.huella');

    renovados.push(relativo);
  }

  return { renovados: renovados, sinManifiesto: false };
}

async function main() {
  const carpeta = path.join(__dirname, '..', 'backup');
  const objetivos = ['loader.swf', 'modules/core.swf', 'clips/pokefus/guide.txt'];

  const resultado = await ponerAlDia(objetivos, carpeta);

  if (resultado.sinManifiesto) {
    console.log('sin version.control: no se puede comprobar si los originales estan al dia');
    return;
  }

  console.log(resultado.renovados.length
    ? 'originales renovados: ' + resultado.renovados.join(', ') +
      '  (el juego se actualizo; revisa si trae texto nuevo)'
    : 'los originales estan al dia');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
module.exports = { ponerAlDia: ponerAlDia };
