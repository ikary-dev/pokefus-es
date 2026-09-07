'use strict';

/*
 * Lector minimo de SWF, suficiente para los ficheros de idioma de Dofus Retro.
 *
 * Esos ficheros no son animaciones: son un unico bloque de bytecode AS2 que
 * declara los textos del juego. Todo el texto vive en un ActionConstantPool,
 * asi que basta con recorrer los tags, localizar ese pool y leerlo. No hace
 * falta interpretar el resto del bytecode para extraer, y para reinyectar solo
 * hay que reescribir el pool y arreglar las longitudes que lo envuelven.
 */

const zlib = require('zlib');

const TAG_DO_ACTION = 12;
const TAG_DO_INIT_ACTION = 59;
const ACTION_CONSTANT_POOL = 0x88;

/*
 * El cuerpo va comprimido en CWS (zlib) y ZWS (LZMA). Solo se descomprime a
 * partir del byte 8: los ocho primeros -- firma, version y longitud -- siempre
 * viajan en claro.
 */
function readSwf(buffer) {
  const signature = buffer.toString('latin1', 0, 3);
  const version = buffer[3];
  const header = buffer.subarray(0, 8);

  let body;
  if (signature === 'CWS') body = zlib.inflateSync(buffer.subarray(8));
  else if (signature === 'FWS') body = buffer.subarray(8);
  else throw new Error(`firma SWF no soportada: ${signature}`);

  return { signature, version, header, body };
}

/*
 * La cabecera del cuerpo empieza por un RECT de longitud variable: cinco bits
 * dicen cuantos bits ocupa cada uno de sus cuatro campos. Hay que medirlo para
 * saber donde arrancan los tags.
 */
function bodyHeaderLength(body) {
  const nbits = body[0] >> 3;
  const rectBits = 5 + nbits * 4;
  return Math.ceil(rectBits / 8) + 4; // + frameRate (2) + frameCount (2)
}

function readTags(body) {
  const tags = [];
  let offset = bodyHeaderLength(body);

  while (offset + 2 <= body.length) {
    const codeAndLength = body.readUInt16LE(offset);
    const code = codeAndLength >> 6;
    let length = codeAndLength & 0x3f;
    let headerLength = 2;

    // 0x3f es la marca de "longitud larga": el tamano real va en los 4 bytes
    // siguientes.
    if (length === 0x3f) {
      length = body.readUInt32LE(offset + 2);
      headerLength = 6;
    }

    const start = offset + headerLength;
    tags.push({ code, start, length, headerStart: offset, headerLength });

    if (code === 0) break; // End
    offset = start + length;
  }

  return tags;
}

/*
 * Dentro de un tag de acciones, cada instruccion es un byte; las que valen
 * 0x80 o mas llevan ademas su propia longitud en dos bytes. Recorrer eso es la
 * unica forma de saltar hasta el pool sin confundir datos con opcodes.
 */
function findConstantPools(body, tags) {
  const pools = [];

  for (const tag of tags) {
    if (tag.code !== TAG_DO_ACTION && tag.code !== TAG_DO_INIT_ACTION) continue;

    // DoInitAction antepone el id del sprite al bytecode.
    let offset = tag.start + (tag.code === TAG_DO_INIT_ACTION ? 2 : 0);
    const end = tag.start + tag.length;

    while (offset < end) {
      const opcode = body[offset];
      if (opcode === 0) break; // fin del bloque de acciones

      if (opcode < 0x80) { offset += 1; continue; }

      const payloadLength = body.readUInt16LE(offset + 1);
      const payloadStart = offset + 3;

      if (opcode === ACTION_CONSTANT_POOL) {
        pools.push(readConstantPool(body, payloadStart, payloadLength, tag));
      }

      offset = payloadStart + payloadLength;
    }
  }

  return pools;
}

function readConstantPool(body, payloadStart, payloadLength, tag) {
  const count = body.readUInt16LE(payloadStart);
  const strings = [];
  let offset = payloadStart + 2;
  const end = payloadStart + payloadLength;

  for (let i = 0; i < count && offset < end; i++) {
    let terminator = offset;
    while (terminator < end && body[terminator] !== 0) terminator++;
    strings.push(body.toString('utf8', offset, terminator));
    offset = terminator + 1;
  }

  return { tag, payloadStart, payloadLength, count, strings };
}

function parseLangSwf(buffer) {
  const swf = readSwf(buffer);
  const tags = readTags(swf.body);
  const pools = findConstantPools(swf.body, tags);
  return { ...swf, tags, pools };
}

module.exports = { readSwf, readTags, findConstantPools, parseLangSwf };
