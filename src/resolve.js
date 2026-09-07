'use strict';

/*
 * Devuelve, en orden, todas las cadenas que el bytecode empuja a la pila.
 *
 * Es la vista que importa: el pool es solo almacen, y tras reinyectar una
 * traduccion el texto ya no vive alli sino en los propios ActionPush. Comparar
 * esta secuencia antes y despues es lo unico que demuestra que la traduccion
 * llego a su sitio y que nada mas se movio.
 *
 * Baja por los DefineSprite igual que la reconstruccion: en loader.swf el texto
 * de la pantalla de conexion esta anidado ahi dentro, y mirar solo el nivel de
 * arriba no lo veria.
 */

const { readSwf } = require('./swf');
const { splitPushValues } = require('./repack');

const TAG_DO_ACTION = 12;
const TAG_DO_INIT_ACTION = 59;
const TAG_DEFINE_SPRITE = 39;
const ACTION_CONSTANT_POOL = 0x88;
const ACTION_PUSH = 0x96;

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

function collectFromActions(body, start, length, isInitAction, pushed, conNumeros) {
  let offset = start + (isInitAction ? 2 : 0);
  const end = start + length;
  let pool = [];

  while (offset < end) {
    const opcode = body[offset];
    if (opcode === 0) break;
    if (opcode < 0x80) { offset += 1; continue; }

    const payloadLength = body.readUInt16LE(offset + 1);
    const payloadStart = offset + 3;

    if (opcode === ACTION_CONSTANT_POOL) {
      pool = readPoolStrings(body, payloadStart, payloadLength);
    } else if (opcode === ACTION_PUSH) {
      const values = splitPushValues(body, payloadStart, payloadLength);

      for (const value of values || []) {
        if (value.type === 0) {
          pushed.push(body.toString('utf8', value.start + 1, value.end - 1));
        } else if (value.type === 8 || value.type === 9) {
          pushed.push(pool[value.index]);
        } else if (conNumeros) {
          /*
           * Los numeros son identicos en todos los idiomas -- ids, niveles,
           * estadisticas -- asi que sirven de ancla para alinear el archivo
           * frances con el espanol y saber que nombre corresponde a cual. Se
           * marcan con almohadilla para no confundirlos con una cadena.
           */
          if (value.type === 7) pushed.push('#' + body.readInt32LE(value.start + 1));
          else if (value.type === 1) pushed.push('#' + body.readFloatLE(value.start + 1));
          else if (value.type === 6) pushed.push('#' + body.readDoubleLE(value.start + 1));
        }
      }
    }

    offset = payloadStart + payloadLength;
  }
}

function walk(body, start, end, pushed, conNumeros) {
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
    if (code === 0 || payloadStart + length > end) break;

    if (code === TAG_DEFINE_SPRITE) {
      walk(body, payloadStart + 4, payloadStart + length, pushed, conNumeros);
    } else if (code === TAG_DO_ACTION || code === TAG_DO_INIT_ACTION) {
      collectFromActions(body, payloadStart, length, code === TAG_DO_INIT_ACTION, pushed, conNumeros);
    }

    offset = payloadStart + length;
  }
}

function resolvePushedStrings(buffer, conNumeros) {
  const swf = readSwf(buffer);
  const nbits = swf.body[0] >> 3;
  const start = Math.ceil((5 + nbits * 4) / 8) + 4;

  const pushed = [];
  walk(swf.body, start, swf.body.length, pushed, conNumeros);
  return pushed;
}

module.exports = { resolvePushedStrings };
