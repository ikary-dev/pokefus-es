'use strict';

/*
 * Localiza el texto que sigue en frances dentro de los ficheros ES.
 *
 * El servidor publica cada fichero en los dos idiomas y con la misma version.
 * Eso da un detector exacto y gratis: si una cadena aparece identica en el
 * fichero ES y en el FR, es que nadie la tradujo. No hay que mantener listas ni
 * comparar contra la version anterior -- cada parche se autodescribe, y por eso
 * el sistema no depende de la version del cliente.
 */

const fs = require('fs');
const path = require('path');
const { parseLangSwf } = require('./swf');
const { fetchManifest, fetchSwf } = require('./lang');
const { classify } = require('./classify');

const OUT = path.join(__dirname, '..', 'tm');

/* Marcas ortograficas que el espanol no tiene y el frances si. */
const FRENCH_MARKS = /[àâçèéêëîïôùûœ]|\b(vous|votre|nous|c'est|n'est|qu'il|d'un|d'une|l'a|les|des|une|est|dans|pour|avec|sur|par|plus|tout|mais|donc|ainsi|afin|lors|deja|etre|avoir|faire)\b/i;
const SPANISH_MARKS = /[ñáíóúü¿¡]|\b(usted|los|las|una|para|con|que|del|por|mas|pero|todo|hacer|puede|ser|tiene|este|esta|sobre|como|cuando|donde|muy|tambien)\b/i;

/* Solo orienta la revision: no decide nada por si sola. */
function frenchness(text) {
  const french = FRENCH_MARKS.test(text);
  const spanish = SPANISH_MARKS.test(text);
  if (french && !spanish) return 'frances';
  if (spanish && !french) return 'espanol';
  return 'ambiguo';
}

function poolStrings(buffer) {
  const parsed = parseLangSwf(buffer);
  const located = [];

  parsed.pools.forEach((pool, poolIndex) => {
    pool.strings.forEach((text, index) => located.push({ poolIndex, index, text }));
  });

  return { parsed, located };
}

async function extractFile(name, esVersion, frVersion) {
  const es = await fetchSwf(name, 'es', esVersion);
  const fr = await fetchSwf(name, 'fr', frVersion);

  const esSide = poolStrings(es.buffer);
  const frSide = poolStrings(fr.buffer);
  const frenchSet = new Set(frSide.located.map((entry) => entry.text));

  /* Una misma cadena puede repetirse; se agrupa por texto y se guardan todas
   * sus posiciones, que es lo que hara falta para reinyectar la traduccion. */
  const byText = new Map();

  for (const entry of esSide.located) {
    if (!frenchSet.has(entry.text)) continue;          // ya esta traducida
    if (classify(entry.text) !== 'prose') continue;    // no es texto de juego

    if (!byText.has(entry.text)) {
      byText.set(entry.text, { text: entry.text, hint: frenchness(entry.text), at: [] });
    }
    byText.get(entry.text).at.push([entry.poolIndex, entry.index]);
  }

  return {
    name,
    esVersion,
    frVersion,
    esStrings: esSide.located.length,
    frStrings: frSide.located.length,
    pending: [...byText.values()],
  };
}

async function main() {
  const esManifest = await fetchManifest('es');
  const frManifest = await fetchManifest('fr');
  const only = process.argv.slice(2);

  const report = [];

  for (const [name, es] of esManifest) {
    if (only.length && !only.includes(name)) continue;

    const fr = frManifest.get(name);
    if (!fr) { console.log(`${name.padEnd(20)} sin par FR, se omite`); continue; }

    try {
      const result = await extractFile(name, es.version, fr.version);
      report.push(result);

      const counts = result.pending.reduce((acc, entry) => {
        acc[entry.hint] = (acc[entry.hint] || 0) + 1;
        return acc;
      }, {});

      console.log(
        `${name.padEnd(20)} es_${result.esVersion.padEnd(5)} ` +
        `${String(result.esStrings).padStart(6)} cadenas | ` +
        `sin traducir: ${String(result.pending.length).padStart(5)} ` +
        `(frances ${counts.frances || 0}, ambiguo ${counts.ambiguo || 0}, espanol ${counts.espanol || 0})`
      );
    } catch (error) {
      console.log(`${name.padEnd(20)} ERROR ${error.message}`);
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pending.json'), JSON.stringify(report, null, 1));

  const total = report.reduce((sum, file) => sum + file.pending.length, 0);
  const french = report.reduce(
    (sum, file) => sum + file.pending.filter((entry) => entry.hint === 'frances').length, 0);

  console.log(`\nTOTAL sin traducir: ${total} cadenas unicas (${french} claramente en frances)`);
  console.log(`Detalle -> tm/pending.json`);
}

main().catch((error) => { console.error(error); process.exit(1); });
