'use strict';

/*
 * Baja la version de AHORA de cada archivo de idioma, en frances y en espanol.
 *
 * Todo lo que hace el proyecto para encontrar texto sin traducir se apoya en
 * comparar los dos idiomas: emparejar nombres por id (pares.js) y detectar lo
 * que Pokefus dejo en frances en su propio archivo espanol (pendientes.js). Esa
 * comparacion solo vale si los dos archivos son de la MISMA version.
 *
 * Y ahi habia un agujero: el cliente solo pide los espanoles -- el servidor
 * local le da esos cuando pide los franceses -- asi que tras una actualizacion
 * la copia francesa se quedaba vieja. Con dialog_es en 1215 y dialog_fr en 1210
 * la comparacion no encontraba nada nuevo, y los dialogos nuevos salian en
 * frances sin aparecer en ninguna lista.
 *
 * Los SWF llevan la version en el nombre y no cambian nunca, asi que lo ya
 * bajado no se vuelve a pedir: una actualizacion cuesta solo los archivos que
 * de verdad cambiaron.
 */

const { fetchManifest, fetchSwf } = require('./lang');

async function main() {
  const idiomas = ['fr', 'es'];
  let nuevos = 0;

  for (const idioma of idiomas) {
    const manifiesto = await fetchManifest(idioma);
    const cambios = [];

    for (const entrada of manifiesto.values()) {
      try {
        const { file, fromCache } = await fetchSwf(entrada.name, idioma, entrada.version);
        if (fromCache) continue;

        cambios.push(file);
        nuevos++;

        /*
         * Se avisa archivo a archivo. La primera vez hay que bajarlo todo --
         * unos once megas -- y sin esto parece que se ha quedado colgado.
         */
        console.log('   bajando ' + entrada.name + ' (' + idioma + ')...');
      } catch (error) {
        console.log('   ' + entrada.name + '_' + idioma + ': ' + error.message);
      }
    }

    console.log(idioma + ': ' + manifiesto.size + ' archivos, ' +
      (cambios.length ? cambios.length + ' nuevos' : 'ninguno nuevo'));
  }

  console.log(nuevos ? nuevos + ' archivos nuevos.' : 'nada que actualizar.');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
