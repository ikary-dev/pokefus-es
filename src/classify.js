'use strict';

/*
 * Que cadenas del pool son texto de juego y cuales son fontaneria.
 *
 * El pool mezcla sin separarlas cuatro cosas: identificadores del bytecode
 * (System, _parent, allowDomain), claves de traduccion (A_ASK_MARRIAGE_B),
 * datos empaquetados en cadena (celdas de mapa, estadisticas, atajos) y el
 * texto que ve el jugador. Solo el ultimo se traduce; colar cualquiera de los
 * otros tres en el traductor romperia el fichero.
 */

/*
 * El preambulo System.security.allowDomain y las clases del reproductor
 * aparecen en el pool de todos los ficheros. Van por nombre porque son un
 * conjunto cerrado y cualquier heuristica que los cubriera se llevaria por
 * delante nombres de objeto legitimos.
 */
const AS2_BUILTINS = new Set([
  'System', 'security', 'allowDomain', 'allowInsecureDomain', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Math', 'Date', 'Function', 'MovieClip',
  'TextField', 'Stage', 'Key', 'Mouse', 'Sound', 'XML', 'LoadVars', 'Selection',
  'prototype', 'constructor', 'undefined', 'null', 'true', 'false', 'this',
  'super', 'arguments', 'length', 'push', 'toString', 'valueOf', 'apply', 'call',
  'ASSetPropFlags', 'flash', 'external', 'ExternalInterface', 'TRIPLEFRAMERATE',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const KEY = /^[A-Z][A-Z0-9_]*$/;
const CAMEL_CASE = /^[a-z]+(?:[A-Z][a-z0-9]*)+$/;   // getNextHighestDepth
const PASCAL_CASE = /^(?:[A-Z][a-z0-9]+){2,}$/;     // MovieClipLoader

/* Condiciones de equipamiento: "CS>80&CV>40", "PO<10". */
const CONDITION = /^[A-Za-z]{1,3}[<>=!~]=?-?\d+(?:[&|][A-Za-z]{1,3}[<>=!~]=?-?\d+)*$/;

/*
 * Datos empaquetados en cadena. Dofus mete tablas enteras en una sola cadena
 * del pool: celdas de mapa, tiradas de dano, listas de atajos. Comparten que
 * usan separadores que la prosa no usa, o que son un continuo alfanumerico sin
 * espacios.
 */
const PACKED_SEPARATORS = /[#|~]/;
const DICE_ROLL = /\d+d\d+[+-]\d+/;
const FILE_NAME = /\.(mp3|swf|jpg|png|xml|txt|wav)$/i;
const HEX_BLOB = /^[0-9a-fA-F]{12,}$/;
const NO_VOWEL_RUN = /^[A-Za-z0-9]{8,}$/;

const NON_PROSE = /^[\s\d.,;:!?()[\]{}\/\|#*+_=<>%$@^~`'"-]*$/;
const URL_OR_PATH = /^(?:https?:|javascript:|file:|[a-z]+:\/\/|[\w.-]+\/[\w./-]+$)/i;
const MARKUP_ONLY = /^<[^>]+>$/;

/* Prosa de verdad: letras agrupadas en palabras, con vocales. */
const HAS_WORD = /[A-Za-zÀ-ÿ]{3,}/;
const HAS_VOWEL = /[aeiouyàâäéèêëíîïóôöúùûü]/i;

/*
 * Las celdas de mapa se codifican en un alfabeto tipo base64 sin separadores:
 * "d8eke2fffufHfWf-". Leen como palabra porque tienen vocales, pero alternan
 * caja cada uno o dos caracteres, cosa que ninguna palabra hace. Tres saltos de
 * minuscula a mayuscula o digito dentro de una cadena sin espacios bastan para
 * separarlas de un nombre propio como "McGregor" o "Do'Anister".
 */
function caseAlternations(text) {
  let count = 0;
  for (let i = 1; i < text.length; i++) {
    if (/[a-z]/.test(text[i - 1]) && /[A-Z0-9]/.test(text[i])) count++;
  }
  return count;
}

function classify(text) {
  if (text.length === 0) return 'empty';
  if (AS2_BUILTINS.has(text)) return 'identifier';
  if (NON_PROSE.test(text)) return 'symbol';
  if (CONDITION.test(text)) return 'condition';
  if (URL_OR_PATH.test(text)) return 'url';
  if (FILE_NAME.test(text)) return 'asset';
  if (MARKUP_ONLY.test(text)) return 'markup';
  if (KEY.test(text)) return 'key';

  if (PACKED_SEPARATORS.test(text) || DICE_ROLL.test(text)) return 'packed';
  if (HEX_BLOB.test(text)) return 'packed';
  if (!text.includes(' ') && NO_VOWEL_RUN.test(text) && !HAS_VOWEL.test(text)) return 'packed';
  if (!/\s/.test(text) && caseAlternations(text) >= 3) return 'packed';

  if (IDENTIFIER.test(text) && (CAMEL_CASE.test(text) || PASCAL_CASE.test(text))) return 'identifier';
  if (text.startsWith('_') && IDENTIFIER.test(text)) return 'identifier';

  if (!HAS_WORD.test(text) || !HAS_VOWEL.test(text)) return 'symbol';
  return 'prose';
}

const isTranslatable = (text) => classify(text) === 'prose';

module.exports = { classify, isTranslatable, AS2_BUILTINS };
