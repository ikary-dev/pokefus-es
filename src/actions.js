'use strict';

/*
 * Reconstruye un bloque de bytecode AS2 recolocando sus referencias internas.
 *
 * Cambiar el texto cambia el tamano de las acciones que lo llevan, y en AS2 hay
 * cuatro cosas que apuntan a una posicion por DISTANCIA en bytes, no por
 * etiqueta: los saltos (Jump, If), el cuerpo declarado de una funcion
 * (DefineFunction, DefineFunction2) y el de un With. Mover una accion sin
 * rehacer esos numeros deja el archivo estructuralmente valido y el codigo
 * apuntando a media instruccion -- en loader.swf eso salia como un bucle
 * infinito y Flash preguntando si abortar el script.
 *
 * Aqui el bloque se parte en acciones, se sustituyen las que toca, se recalculan
 * las posiciones nuevas y se reescribe cada distancia. Los cuatro campos son de
 * ancho fijo, asi que cambiar su valor no cambia ningun tamano y basta una
 * pasada.
 */

const ACTION_JUMP = 0x99;
const ACTION_IF = 0x9d;
const ACTION_WITH = 0x94;
const ACTION_DEFINE_FUNCTION = 0x9b;
const ACTION_DEFINE_FUNCTION_2 = 0x8e;

function parseBlock(body, start, end) {
  const actions = [];
  let offset = start;

  /*
   * El byte 0 no siempre cierra el bloque: tambien aparece dentro, cerrando el
   * cuerpo de una funcion. Pararse en el primero deja media lista sin indexar,
   * y entonces los saltos que apuntan mas alla no se saben recolocar -- eran
   * cuatro bloques de loader.swf que se quedaban en frances por eso. Se recorre
   * hasta el final y se trata como una accion mas de un byte.
   */
  while (offset < end) {
    const opcode = body[offset];

    if (opcode < 0x80) {
      actions.push({ opcode: opcode, at: offset, end: offset + 1, payloadStart: -1, payloadLength: 0 });
      offset += 1;
      continue;
    }

    if (offset + 3 > end) return null; // cabecera truncada: no se toca el bloque
    const payloadLength = body.readUInt16LE(offset + 1);
    const payloadStart = offset + 3;
    if (payloadStart + payloadLength > end) return null;

    actions.push({
      opcode: opcode,
      at: offset,
      end: payloadStart + payloadLength,
      payloadStart: payloadStart,
      payloadLength: payloadLength,
    });

    offset = payloadStart + payloadLength;
  }

  return { actions: actions, tail: offset };
}

/*
 * replace(action, index) devuelve el payload nuevo de esa accion, o null para
 * dejarla como estaba. Si nada cambia, se devuelve null y el llamante conserva
 * los bytes originales sin copiarlos.
 */
function rebuildBlock(body, start, end, replace, diag) {
  const parsed = parseBlock(body, start, end);
  if (!parsed) { if (diag) diag.noParsea = (diag.noParsea||0)+1; return null; }

  const actions = parsed.actions;
  const payloads = [];
  let cambiado = false;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const nuevo = replace(action, i);

    if (nuevo) {
      cambiado = true;
      payloads.push(nuevo);
    } else if (action.payloadStart === -1) {
      payloads.push(null); // accion de un solo byte
    } else {
      payloads.push(Buffer.from(body.subarray(action.payloadStart, action.end)));
    }
  }

  if (!cambiado) { if (diag) diag.sinCambios = (diag.sinCambios||0)+1; return null; }

  /* Posiciones nuevas. El indice actions.length representa el final del
   * bloque, que es destino legitimo de un salto hacia adelante. */
  const nuevoInicio = new Array(actions.length + 1);
  let cursor = 0;

  for (let i = 0; i < actions.length; i++) {
    nuevoInicio[i] = cursor;
    cursor += payloads[i] === null ? 1 : 3 + payloads[i].length;
  }
  nuevoInicio[actions.length] = cursor;

  const porPosicion = new Map();
  for (let i = 0; i < actions.length; i++) porPosicion.set(actions[i].at, i);
  porPosicion.set(parsed.tail, actions.length);

  const nuevoFinal = function (i) {
    return payloads[i] === null ? nuevoInicio[i] + 1 : nuevoInicio[i] + 3 + payloads[i].length;
  };

  /*
   * Un destino que no cae en el arranque de ninguna accion no se sabe recolocar
   * -- pasaria con bytecode ofuscado -- y entonces se prefiere no tocar el
   * bloque antes que entregarlo roto.
   */
  const destino = function (posicionAntigua) {
    const indice = porPosicion.get(posicionAntigua);
    return indice === undefined ? -1 : nuevoInicio[indice];
  };

  /*
   * Los cuatro campos son de ancho fijo: un salto no puede alejarse mas de
   * 32767 bytes ni un cuerpo de funcion medir mas de 65535. Traducir engorda el
   * bloque, y si con eso alguna distancia deja de caber, el bloque se devuelve
   * sin tocar. Es texto que se queda en frances, no un cliente roto.
   */
  const cabeEnInt16 = function (valor) { return valor >= -32768 && valor <= 32767; };
  const cabeEnUint16 = function (valor) { return valor >= 0 && valor <= 65535; };

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const payload = payloads[i];
    if (payload === null) continue;

    if (action.opcode === ACTION_JUMP || action.opcode === ACTION_IF) {
      const antiguo = body.readInt16LE(action.payloadStart);
      const nuevo = destino(action.end + antiguo);
      if (nuevo === -1) { if (diag) diag.destino = (diag.destino||0)+1; return null; }

      const distancia = nuevo - nuevoFinal(i);
      if (!cabeEnInt16(distancia)) {
        if (diag) { diag.int16 = (diag.int16||0)+1; diag.peor = Math.max(diag.peor||0, Math.abs(distancia)); }
        return null;
      }
      payload.writeInt16LE(distancia, 0);
      continue;
    }

    if (action.opcode === ACTION_WITH) {
      const tamano = body.readUInt16LE(action.payloadStart);
      const nuevo = destino(action.end + tamano);
      if (nuevo === -1) { if (diag) diag.destino = (diag.destino||0)+1; return null; }

      const distancia = nuevo - nuevoFinal(i);
      if (!cabeEnUint16(distancia)) { if (diag) diag.uint16 = (diag.uint16||0)+1; return null; }
      payload.writeUInt16LE(distancia, 0);
      continue;
    }

    if (action.opcode === ACTION_DEFINE_FUNCTION || action.opcode === ACTION_DEFINE_FUNCTION_2) {
      // codeSize son siempre los dos ultimos bytes del payload.
      const tamano = body.readUInt16LE(action.end - 2);
      const nuevo = destino(action.end + tamano);
      if (nuevo === -1) { if (diag) diag.destino = (diag.destino||0)+1; return null; }

      const distancia = nuevo - nuevoFinal(i);
      if (!cabeEnUint16(distancia)) { if (diag) diag.uint16 = (diag.uint16||0)+1; return null; }
      payload.writeUInt16LE(distancia, payload.length - 2);
    }
  }

  const piezas = [];
  for (let i = 0; i < actions.length; i++) {
    const payload = payloads[i];

    if (payload === null) {
      piezas.push(Buffer.from([actions[i].opcode]));
      continue;
    }

    const cabecera = Buffer.alloc(3);
    cabecera[0] = actions[i].opcode;
    cabecera.writeUInt16LE(payload.length, 1);
    piezas.push(cabecera, payload);
  }

  piezas.push(Buffer.from(body.subarray(parsed.tail, end)));
  return Buffer.concat(piezas);
}

module.exports = { parseBlock, rebuildBlock };
