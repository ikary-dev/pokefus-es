'use strict';

/*
 * Reescribe el texto de un SWF sin romper el codigo que lo rodea.
 *
 * Dos estrategias, porque los dos tipos de archivo tienen limites opuestos:
 *
 *   'pool'   reescribe las cadenas dentro del ActionConstantPool. Es lo natural,
 *            pero la longitud del pool es un uint16 y el generador de Dofus los
 *            rellena al tope: 21 de los 198 pools de los archivos de idioma
 *            miden 65535 B exactos, justo los de items y dialog.
 *
 *   'inline' deja el pool intacto y convierte la referencia en un ActionPush con
 *            la cadena literal. No tiene limite de tamano, pero engorda el
 *            archivo, asi que solo compensa donde el pool ya no da mas.
 *
 * En los dos casos cambia el tamano de alguna accion, y de recolocar los saltos
 * y los cuerpos de funcion se encarga actions.js. Sin eso el archivo queda
 * valido pero el codigo salta a media instruccion: loader.swf se quedaba en un
 * bucle infinito.
 */

const zlib = require('zlib');
const { readSwf } = require('./swf');
const { rebuildBlock } = require('./actions');

const TAG_DO_ACTION = 12;
const TAG_DO_INIT_ACTION = 59;
const TAG_DEFINE_SPRITE = 39;

const ACTION_CONSTANT_POOL = 0x88;
const ACTION_PUSH = 0x96;

const PUSH_STRING = 0;
const PUSH_CONSTANT_8 = 8;
const PUSH_CONSTANT_16 = 9;

/* Tamano del valor que sigue al byte de tipo, sin contar ese byte. */
const PUSH_VALUE_SIZE = { 1: 4, 2: 0, 3: 0, 4: 1, 5: 1, 6: 8, 7: 4, 8: 1, 9: 2 };

const MAX_POOL = 0xffff;

/*
 * Trocea el payload de un ActionPush en valores tipados. Es la unica parte del
 * bytecode que hay que entender para traducir; el resto se copia sin mirarlo.
 */
function splitPushValues(body, start, length) {
  const values = [];
  const end = start + length;
  let offset = start;

  while (offset < end) {
    const type = body[offset];

    if (type === PUSH_STRING) {
      let terminator = offset + 1;
      while (terminator < end && body[terminator] !== 0) terminator++;
      values.push({ type: type, start: offset, end: terminator + 1 });
      offset = terminator + 1;
      continue;
    }

    const size = PUSH_VALUE_SIZE[type];
    if (size === undefined) return null; // tipo desconocido: no se toca el tag

    const index = type === PUSH_CONSTANT_8 ? body[offset + 1]
      : type === PUSH_CONSTANT_16 ? body.readUInt16LE(offset + 1)
        : null;

    values.push({ type: type, index: index, start: offset, end: offset + 1 + size });
    offset += 1 + size;
  }

  return values;
}

function readPoolStrings(body, payloadStart, payloadLength) {
  const count = body.readUInt16LE(payloadStart);
  const strings = [];
  const end = payloadStart + payloadLength;
  let offset = payloadStart + 2;

  for (let i = 0; i < count && offset < end; i++) {
    let terminator = offset;
    while (terminator < end && body[terminator] !== 0) terminator++;
    strings.push(body.toString('utf8', offset, terminator));
    offset = terminator + 1;
  }

  return strings;
}

function encodePool(strings) {
  const encoded = strings.map(function (text) { return Buffer.from(text, 'utf8'); });
  const size = 2 + encoded.reduce(function (total, buffer) { return total + buffer.length + 1; }, 0);
  if (size > MAX_POOL) throw new Error('el pool traducido ocupa ' + size + ' B y el maximo es ' + MAX_POOL);

  const payload = Buffer.alloc(size);
  payload.writeUInt16LE(strings.length, 0);

  let offset = 2;
  for (const buffer of encoded) {
    buffer.copy(payload, offset);
    offset += buffer.length;
    payload[offset++] = 0;
  }

  return payload;
}

function encodeLiteralPush(text) {
  const encoded = Buffer.from(text, 'utf8');
  const value = Buffer.alloc(encoded.length + 2);
  value[0] = PUSH_STRING;
  encoded.copy(value, 1);
  value[value.length - 1] = 0;
  return value;
}

/*
 * El pool vigente cambia a lo largo del bloque, asi que se lleva al vuelo para
 * resolver bien cada indice. Devuelve el payload nuevo de la accion, o null si
 * esa accion se queda como esta.
 */
function makeReplacer(body, translations, stats) {
  let pool = [];

  return function (action) {
    if (action.opcode === ACTION_CONSTANT_POOL) {
      pool = readPoolStrings(body, action.payloadStart, action.payloadLength);

      if (stats.estrategia !== 'pool') return null;

      let alguna = false;
      const nuevo = pool.map(function (text) {
        const t = translations.get(text);
        if (t === undefined) return text;
        alguna = true;
        stats.rewritten++;
        stats.applied.add(text);
        return t;
      });

      return alguna ? encodePool(nuevo) : null;
    }

    if (stats.estrategia === 'pool' || action.opcode !== ACTION_PUSH) return null;

    const values = splitPushValues(body, action.payloadStart, action.payloadLength);
    if (!values) return null;

    const piezas = [];
    let alguna = false;

    for (const value of values) {
      const source = value.type === PUSH_STRING
        ? body.toString('utf8', value.start + 1, value.end - 1)
        : (value.type === PUSH_CONSTANT_8 || value.type === PUSH_CONSTANT_16) ? pool[value.index] : undefined;

      const translated = source === undefined ? undefined : translations.get(source);

      if (translated === undefined) {
        piezas.push(body.subarray(value.start, value.end));
        continue;
      }

      piezas.push(encodeLiteralPush(translated));
      alguna = true;
      stats.rewritten++;
      stats.applied.add(source);
    }

    return alguna ? Buffer.concat(piezas) : null;
  };
}

/*
 * Traduce sin mover un solo byte, escribiendo encima de la cadena original.
 *
 * Ultimo recurso para los bloques que no se pueden rehacer. En loader.swf hay
 * cinco con el bytecode protegido: mil cuatrocientos saltos apuntan a sitios que
 * no son el arranque de ninguna accion, asi que recalcular las distancias es
 * imposible y el bloque se dejaba entero en frances -- treinta y cinco mensajes,
 * entre ellos los de carga y los errores de conexion.
 *
 * Pero si la traduccion no es mas larga que el original, no hace falta recalcular
 * nada: se escribe encima y se rellena con espacios hasta completar el hueco. El
 * bloque mide exactamente lo mismo que antes, asi que todos los saltos siguen
 * siendo validos. Lo que no quepa se queda en frances, que es lo que ya pasaba.
 */
function traducirEnSitio(bloque, translations, stats) {
  const copia = Buffer.from(bloque);
  let offset = 0;

  while (offset < copia.length) {
    const opcode = copia[offset];
    if (opcode === 0) break;
    if (opcode < 0x80) { offset += 1; continue; }
    if (offset + 3 > copia.length) break;

    const largo = copia.readUInt16LE(offset + 1);
    const inicio = offset + 3;
    if (inicio + largo > copia.length) break;

    if (opcode === ACTION_CONSTANT_POOL) {
      const fin = inicio + largo;
      let o = inicio + 2;

      while (o < fin) {
        let t = o;
        while (t < fin && copia[t] !== 0) t++;

        const original = copia.toString('utf8', o, t);
        const traducido = translations.get(original);
        const cabe = traducido !== undefined && Buffer.byteLength(traducido, 'utf8') <= t - o;

        if (cabe) {
          const texto = Buffer.from(traducido, 'utf8');
          copia.fill(0x20, o, t);          // espacios: el hueco mide lo mismo
          texto.copy(copia, o);
          stats.rewritten++;
          stats.applied.add(original);
          if (stats.diag) stats.diag.enSitio = (stats.diag.enSitio || 0) + 1;
        }

        o = t + 1;
      }
    }

    offset = inicio + largo;
  }

  return copia;
}

/* Cuanto crece el bloque al cambiar este texto por su traduccion. */
function crecimiento(original, traducido) {
  return Buffer.byteLength(traducido, 'utf8') - Buffer.byteLength(original, 'utf8');
}

/*
 * Rehace el bloque, y si no cabe, aparta traducciones hasta que quepa.
 *
 * Los saltos de AS2 guardan la distancia en un entero de 16 bits, asi que un
 * bloque no puede crecer tanto como para que un salto pase de 32767 bytes. Al
 * traducir crece: el espanol ocupa mas que el frances.
 *
 * Antes, si un solo salto se pasaba, se devolvia el bloque ENTERO sin tocar. Y
 * como el contador de aplicadas ya se habia sumado, el informe decia "882
 * cadenas" mientras el archivo salia integro en frances. Asi es como los
 * dialogos siguieron en frances durante semanas: no fallaba la traduccion,
 * fallaba en silencio el ultimo paso.
 *
 * Ahora, cuando no cabe, se aparta la traduccion que mas engorda el bloque y se
 * reintenta. El desbordamiento suele ser de unas decenas de bytes, asi que con
 * apartar una o dos frases largas basta y entran las otras ochocientas.
 */
function rewriteActions(body, start, length, isInitAction, translations, stats) {
  const prefijo = isInitAction ? 2 : 0;
  const original = body.subarray(start, start + length);

  let mapa = translations;
  const apartadas = [];

  for (let intento = 0; intento < 60; intento++) {
    const parcial = { rewritten: 0, applied: new Set(), estrategia: stats.estrategia };
    const motivo = {};

    const rebuilt = rebuildBlock(
      body, start + prefijo, start + length, makeReplacer(body, mapa, parcial), motivo);

    if (rebuilt) {
      stats.rewritten += parcial.rewritten;
      for (const texto of parcial.applied) stats.applied.add(texto);
      if (stats.diag && apartadas.length) {
        stats.diag.apartadasPorTamano = (stats.diag.apartadasPorTamano || []).concat(apartadas);
      }
      return Buffer.concat([body.subarray(start, start + prefijo), rebuilt]);
    }

    // Si no fue por tamano no hay nada que apartar: el bloque se queda igual.
    if (stats.diag && motivo.noParsea) stats.diag.noParsea = (stats.diag.noParsea || 0) + 1;
    if (stats.diag && motivo.destino) stats.diag.destino = (stats.diag.destino || 0) + 1;

    if (!motivo.int16 && !motivo.uint16) {
      if (motivo.sinCambios) return original;

      if (stats.diag) stats.diag.bloquesAbandonados = (stats.diag.bloquesAbandonados || 0) + 1;
      return traducirEnSitio(original, mapa, stats);
    }

    // La que mas engorda de las que de verdad se usaron en este bloque.
    let peor = null;
    for (const texto of parcial.applied) {
      const cuanto = crecimiento(texto, mapa.get(texto));
      if (cuanto <= 0) continue;
      if (!peor || cuanto > peor.cuanto) peor = { texto: texto, cuanto: cuanto };
    }

    if (!peor) {
      if (stats.diag) stats.diag.bloquesAbandonados = (stats.diag.bloquesAbandonados || 0) + 1;
      return traducirEnSitio(original, mapa, stats);
    }

    mapa = new Map(mapa);
    mapa.delete(peor.texto);
    apartadas.push(peor.texto);
  }

  if (stats.diag) stats.diag.bloquesAbandonados = (stats.diag.bloquesAbandonados || 0) + 1;
  return traducirEnSitio(original, mapa, stats);
}

/* La forma larga vale para cualquier tamano: se emite siempre y no hay que
 * decidir si el tag reescrito cruzo el umbral de 63 bytes. */
function writeTag(code, payload) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 0x3f, 0);
  header.writeUInt32LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function bodyHeaderLength(body) {
  const nbits = body[0] >> 3;
  return Math.ceil((5 + nbits * 4) / 8) + 4;
}

/*
 * Los tags se anidan: un DefineSprite lleva dentro su propia lista, y ahi es
 * donde loader.swf guarda el texto de la pantalla de conexion. Recorrer solo el
 * nivel de arriba dejaria sin tocar justo lo que mas se ve.
 */
function rebuildTagList(body, start, end, translations, stats) {
  const pieces = [];
  let offset = start;

  while (offset + 2 <= end) {
    const codeAndLength = body.readUInt16LE(offset);
    const code = codeAndLength >> 6;
    let length = codeAndLength & 0x3f;
    let headerLength = 2;

    if (length === 0x3f) {
      length = body.readUInt32LE(offset + 2);
      headerLength = 6;
    }

    const payloadStart = offset + headerLength;
    if (payloadStart + length > end) break;

    if (code === 0) {
      pieces.push(body.subarray(offset, payloadStart)); // End, tal cual
      offset = payloadStart;
      break;
    }

    if (code === TAG_DEFINE_SPRITE) {
      const inner = rebuildTagList(body, payloadStart + 4, payloadStart + length, translations, stats);
      pieces.push(writeTag(code, Buffer.concat([body.subarray(payloadStart, payloadStart + 4), inner])));
    } else if (code === TAG_DO_ACTION || code === TAG_DO_INIT_ACTION) {
      pieces.push(writeTag(code, rewriteActions(
        body, payloadStart, length, code === TAG_DO_INIT_ACTION, translations, stats)));
    } else {
      pieces.push(body.subarray(offset, payloadStart + length));
    }

    offset = payloadStart + length;
  }

  pieces.push(body.subarray(offset, end));
  return Buffer.concat(pieces);
}

/* translations: Map<textoOriginal, textoTraducido> */
function repackLangSwf(buffer, translations, opciones) {
  const swf = readSwf(buffer);
  const estrategia = opciones && opciones.estrategia ? opciones.estrategia : 'inline';
  const stats = {
    rewritten: 0,
    applied: new Set(),
    estrategia: estrategia,
    diag: (opciones && opciones.diag) || null,
  };
  const inicio = bodyHeaderLength(swf.body);

  const body = Buffer.concat([
    swf.body.subarray(0, inicio),
    rebuildTagList(swf.body, inicio, swf.body.length, translations, stats),
  ]);

  /* FileLength cuenta el fichero descomprimido entero, cabecera incluida. */
  const header = Buffer.from(swf.header);
  header.write('CWS', 0, 'latin1');
  header.writeUInt32LE(body.length + 8, 4);

  return {
    buffer: Buffer.concat([header, zlib.deflateSync(body, { level: 9 })]),
    rewritten: stats.rewritten,
    applied: stats.applied,
    abandonados: stats.diag ? stats.diag.bloquesAbandonados || 0 : 0,
  };
}

module.exports = { repackLangSwf, splitPushValues };
