'use strict';

/*
 * Avisa de las traducciones que el bytecode no usa como texto.
 *
 * Una cadena del pool puede acabar en pantalla o puede ser el nombre de una
 * propiedad o el termino de una comparacion. Traducir las primeras es el
 * objetivo; traducir las segundas cambia el comportamiento del programa, y el
 * sintoma no se parece en nada a un fallo de traduccion: un contador que deja
 * de salir, una lista que se queda vacia.
 *
 * Se distingue por lo que hace el bytecode justo despues de apilar la cadena:
 *
 *   GetMember / SetMember  -> es el nombre de una propiedad
 *   Equals / StrictEquals  -> se esta comparando con algo
 *
 * En los dos casos la traduccion es sospechosa. No siempre es un fallo -- si
 * los dos lados de la comparacion se traducen igual, sigue cuadrando -- pero es
 * donde hay que mirar cuando algo deja de funcionar.
 */

const fs = require('fs');
const path = require('path');
const { readSwf } = require('./swf');
const { splitPushValues } = require('./repack');

const ACTION_CONSTANT_POOL = 0x88;
const ACTION_PUSH = 0x96;

/*
 * Opcodes que consumen una cadena como IDENTIFICADOR, no como texto.
 *
 * La primera version solo miraba tres y se quedo muy corta: en AS2 una cadena
 * puede ser tambien el nombre de una variable, de un metodo al que se llama, de
 * una funcion o de una clase. Traducir cualquiera de esas cambia el
 * comportamiento, y el sintoma no se parece a un fallo de idioma -- en combate
 * salia un contador vacio y los Dofemons del cambio apagados, como si no se
 * pudieran elegir.
 */
const USOS = {
  0x1c: 'lee una variable con ese nombre',
  0x1d: 'escribe una variable con ese nombre',
  0x3c: 'declara una variable con ese nombre',
  0x41: 'declara una variable con ese nombre',
  0x3d: 'llama a una funcion con ese nombre',
  0x52: 'llama a un metodo con ese nombre',
  0x53: 'construye con ese nombre',
  0x40: 'construye un objeto de esa clase',
  0x4e: 'lee una propiedad con ese nombre',
  0x4f: 'escribe una propiedad con ese nombre',
  0x3a: 'borra una propiedad con ese nombre',
  0x3b: 'borra una variable con ese nombre',
  0x45: 'la usa como ruta de objeto',
  0x20: 'la usa como destino',
  0x8b: 'la usa como destino',
  0x2b: 'la usa como tipo',
  0x0e: 'la compara',
  0x49: 'la compara',
  0x66: 'la compara',
};

function leerPool(cuerpo, inicio, largo) {
  const cuantas = cuerpo.readUInt16LE(inicio);
  const cadenas = [];
  const fin = inicio + largo;
  let o = inicio + 2;

  for (let i = 0; i < cuantas && o < fin; i++) {
    let t = o;
    while (t < fin && cuerpo[t] !== 0) t++;
    cadenas.push(cuerpo.toString('utf8', o, t));
    o = t + 1;
  }

  return cadenas;
}

/*
 * Donde esta el identificador dentro de lo que se acaba de apilar.
 *
 * 0 es lo ultimo apilado, 1 lo anterior. Importa mucho: en una escritura de
 * propiedad la pila lleva objeto, NOMBRE y valor, asi que el nombre es el
 * penultimo y el ultimo es el texto que se guarda. Marcando los dos, cualquier
 * frase guardada en una propiedad quedaba senalada como peligrosa sin serlo --
 * doscientos sesenta dialogos, entre ellos -- y eso vaciaba la traduccion por
 * miedo a un fallo que no existia.
 *
 * Cuando la posicion no se puede saber -- llamadas a metodo, constructores, que
 * llevan un numero variable de argumentos -- se marcan todas las cadenas: mas
 * vale una etiqueta en frances que una funcion rota.
 */
const POSICION = {
  0x4e: [0],       // lee propiedad: el nombre es lo ultimo
  0x4f: [1],       // escribe propiedad: objeto, NOMBRE, valor
  0x1c: [0],       // lee variable
  0x1d: [1],       // escribe variable: NOMBRE, valor
  0x3c: [1],       // declara variable con valor
  0x41: [0],       // declara variable
  0x3a: [0],       // borra propiedad
  0x3b: [0],       // borra variable
  0x20: [0],       // destino
  0x8b: [0],       // destino
  0x2b: [0],       // tipo
  0x0e: [0, 1],    // compara: los dos lados
  0x49: [0, 1],
  0x66: [0, 1],
};

function revisarBloque(cuerpo, inicio, largo, esInit, aviso) {
  let o = inicio + (esInit ? 2 : 0);
  const fin = inicio + largo;
  let pool = [];
  let ultimas = [];

  while (o < fin) {
    const opcode = cuerpo[o];
    if (opcode === 0) { o += 1; ultimas = []; continue; }

    if (opcode < 0x80) {
      if (USOS[opcode]) {
        const posiciones = POSICION[opcode];

        if (!posiciones) {
          for (const cadena of ultimas) aviso(cadena, USOS[opcode]);
        } else {
          for (const desdeArriba of posiciones) {
            const cadena = ultimas[ultimas.length - 1 - desdeArriba];
            if (typeof cadena === 'string') aviso(cadena, USOS[opcode]);
          }
        }
      }

      ultimas = [];
      o += 1;
      continue;
    }

    const largoPayload = cuerpo.readUInt16LE(o + 1);
    const inicioPayload = o + 3;

    if (opcode === ACTION_CONSTANT_POOL) {
      pool = leerPool(cuerpo, inicioPayload, largoPayload);
    } else if (opcode === ACTION_PUSH) {
      ultimas = [];
      for (const valor of splitPushValues(cuerpo, inicioPayload, largoPayload) || []) {
        if (valor.type === 0) ultimas.push(cuerpo.toString('utf8', valor.start + 1, valor.end - 1));
        else if (valor.type === 8 || valor.type === 9) ultimas.push(pool[valor.index]);
        else ultimas.push(null);
      }
    } else {
      ultimas = [];
    }

    o = inicioPayload + largoPayload;
  }
}

function recorrer(cuerpo, inicio, fin, aviso) {
  let o = inicio;

  while (o + 2 <= fin) {
    const cabecera = cuerpo.readUInt16LE(o);
    const codigo = cabecera >> 6;
    let largo = cabecera & 0x3f;
    let salto = 2;

    if (largo === 0x3f) { largo = cuerpo.readUInt32LE(o + 2); salto = 6; }

    const inicioTag = o + salto;
    if (codigo === 0 || inicioTag + largo > fin) break;

    if (codigo === 39) recorrer(cuerpo, inicioTag + 4, inicioTag + largo, aviso);
    else if (codigo === 12 || codigo === 59) revisarBloque(cuerpo, inicioTag, largo, codigo === 59, aviso);

    o = inicioTag + largo;
  }
}

/*
 * Devuelve las cadenas del diccionario que el bytecode NO usa como texto y que
 * por tanto no se deben traducir.
 *
 * CUALQUIER uso como identificador basta para apartarla. Antes solo contaban
 * las comparaciones y las lecturas de propiedad, con el razonamiento de que
 * escribir una propiedad es inofensivo porque la lectura estaria en este mismo
 * archivo y se traduciria igual.
 *
 * Ese razonamiento era falso y costo caro. El que lee no siempre esta aqui: el
 * panel lateral es HTML y lee propiedades del Flash por el puente, y el
 * servidor manda claves que el cliente busca tal cual. Traducir la escritura
 * dejaba la propiedad con nombre espanol y al que la buscaba en frances sin
 * encontrarla. De ahi salieron el relevo en combate que no recibia dano, el
 * calculo del dano estimado que dejo de salir y los valores raros en la caja de
 * Dofemons: no eran fallos de traduccion, eran funciones rotas.
 *
 * Perder una etiqueta en frances no se nota casi. Romper una funcion, si.
 */
const USOS_PELIGROSOS = null;   // null = cualquier uso como identificador

function cadenasIntocables(rutaSwf, tabla) {
  const cuerpo = readSwf(fs.readFileSync(rutaSwf)).body;
  const nbits = cuerpo[0] >> 3;
  const intocables = new Set();

  recorrer(cuerpo, Math.ceil((5 + nbits * 4) / 8) + 4, cuerpo.length, function (cadena, uso) {
    if (typeof cadena !== 'string') return;
    if (!Object.prototype.hasOwnProperty.call(tabla, cadena)) return;
    if (USOS_PELIGROSOS !== null && USOS_PELIGROSOS.indexOf(uso) === -1) return;
    intocables.add(cadena);
  });

  return intocables;
}

function main() {
  const raiz = path.join(__dirname, '..');
  const objetivos = [
    ['backup/modules/core.swf', 'tm/core.json'],
    ['backup/loader.swf', 'tm/loader.json'],
  ];

  for (const [swf, diccionario] of objetivos) {
    const ruta = path.join(raiz, swf);
    if (!fs.existsSync(ruta)) { console.log(swf + ': sin copia original'); continue; }

    const tabla = JSON.parse(fs.readFileSync(path.join(raiz, diccionario), 'utf8'));
    const cuerpo = readSwf(fs.readFileSync(ruta)).body;
    const nbits = cuerpo[0] >> 3;
    const sospechosas = new Map();

    recorrer(cuerpo, Math.ceil((5 + nbits * 4) / 8) + 4, cuerpo.length, function (cadena, uso) {
      // hasOwnProperty y no tabla[cadena]: "__proto__" devolveria el prototipo
      // del objeto, que es truthy, y saldria como falso positivo.
      if (typeof cadena !== 'string') return;
      if (!Object.prototype.hasOwnProperty.call(tabla, cadena)) return;
      if (!sospechosas.has(cadena)) sospechosas.set(cadena, new Set());
      sospechosas.get(cadena).add(uso);
    });

    console.log('\n=== ' + swf + ' — ' + sospechosas.size + ' traducciones sospechosas');
    for (const [cadena, usos] of sospechosas) {
      console.log('   ' + JSON.stringify(cadena) + ' -> ' + JSON.stringify(tabla[cadena]) +
        '   (' + [...usos].join(', ') + ')');
    }
  }
}

if (require.main === module) main();
/*
 * Todos los usos como identificador de cada cadena del diccionario. Sirve para
 * auditar: cadenasIntocables solo dice si hay que apartarla, esto dice por que.
 */
function usosDe(rutaSwf, tabla) {
  const cuerpo = readSwf(fs.readFileSync(rutaSwf)).body;
  const nbits = cuerpo[0] >> 3;
  const mapa = new Map();

  recorrer(cuerpo, Math.ceil((5 + nbits * 4) / 8) + 4, cuerpo.length, function (cadena, uso) {
    if (typeof cadena !== 'string') return;
    if (!Object.prototype.hasOwnProperty.call(tabla, cadena)) return;
    if (!mapa.has(cadena)) mapa.set(cadena, new Set());
    mapa.get(cadena).add(uso);
  });

  return mapa;
}

module.exports = { cadenasIntocables: cadenasIntocables, usosDe: usosDe };
