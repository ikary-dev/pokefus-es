'use strict';

/*
 * Prueba de ida y vuelta del reempaquetado.
 *
 * Se traduce a lo bruto -- toda cadena de prosa se envuelve en marcas y se
 * alarga -- y despues se comprueba que la secuencia de cadenas que el bytecode
 * empuja es exactamente la esperada. Alargar a proposito es lo que importa: el
 * espanol casi nunca mide lo mismo que el frances, y es ahi donde fallaria una
 * reescritura que se dejase alguna longitud sin recalcular.
 */

const fs = require('fs');
const path = require('path');
const { repackLangSwf } = require('./repack');
const { resolvePushedStrings } = require('./resolve');
const { classify } = require('./classify');
const { CACHE } = require('./lang');

function check(file) {
  const original = fs.readFileSync(path.join(CACHE, file));
  const before = resolvePushedStrings(original);

  /* Se alarga cada cadena de forma distinta para forzar todos los recalculos. */
  const translations = new Map();
  before.forEach((text, i) => {
    if (typeof text === 'string' && classify(text) === 'prose' && !translations.has(text)) {
      translations.set(text, `«${'~'.repeat(i % 11)}${text}»`);
    }
  });

  const result = repackLangSwf(original, translations);
  const after = resolvePushedStrings(result.buffer);

  const expected = before.map((text) => translations.get(text) ?? text);
  const ok = after.length === expected.length && after.every((text, i) => text === expected[i]);

  const missed = [...translations.keys()].filter((text) => !result.applied.has(text));

  console.log(
    `${file.padEnd(26)} empujadas ${String(before.length).padStart(6)} | ` +
    `traducciones ${String(translations.size).padStart(5)} | ` +
    `reescritas ${String(result.rewritten).padStart(6)} | ` +
    `sin aplicar ${String(missed.length).padStart(4)} | ` +
    `secuencia ${ok ? 'OK   ' : 'FALLA'} | ` +
    `${original.length} -> ${result.buffer.length} B`
  );

  return ok && missed.length === 0;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(CACHE).filter((file) => file.endsWith('.swf'));

const failures = files.filter((file) => !check(file));
console.log(failures.length
  ? `\nFALLAN: ${failures.join(', ')}`
  : `\nTodos correctos (${files.length} ficheros)`);
process.exit(failures.length ? 1 : 0);
