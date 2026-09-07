'use strict';

/*
 * Traduce el texto que llega por el socket del juego.
 *
 * Una parte de lo que se ve en pantalla no esta en ningun archivo: el
 * temperamento de un Dofemon, su talento, el nivel de vinculo y los mensajes de
 * chat los escribe el servidor y llegan por TCP. Ningun parche de archivo los
 * alcanza, asi que el cliente se conecta aqui y esto habla con Pokefus por el.
 *
 * El protocolo de Dofus 1.29 es texto: el servidor termina cada mensaje en un
 * byte cero y el cliente en un salto de linea. No hay longitudes declaradas, de
 * modo que una traduccion mas larga o mas corta que el original no rompe nada
 * mientras no introduzca un separador.
 *
 * REGLA DE ORO: ante cualquier fallo, dejar pasar los bytes tal cual. Un texto
 * en frances es un incordio; un cliente que no conecta es un juego que no se
 * puede jugar.
 */

const net = require('net');
const fs = require('fs');

const SEPARADOR_SERVIDOR = 0x00;

/* Caracteres que estructuran el protocolo: una traduccion que los llevara
 * partiria el mensaje en campos que el cliente leeria mal. */
const SEPARADORES = /[|;~\n\x00]/;

/*
 * Tras elegir servidor, el de conexion manda al cliente la direccion del de
 * juego y el cliente se va alli. Si esa direccion pasa intacta, el proxy deja
 * de ver el trafico que de verdad importa -- chat, combates, fichas -- porque
 * todo eso viene del servidor de juego, no del de conexion.
 *
 * El mensaje es "AYKgame.pokefus.org:5555;77": un NOMBRE DE HOST, no una IP.
 * Buscar solo IPv4 no encontraba nada y el cliente se conectaba directo.
 *
 * La sustitucion se limita a ese mensaje. Un patron suelto de host:puerto
 * podria encontrar coincidencias dentro del chat de los jugadores, y reescribir
 * ahi seria corromper texto por nada.
 */
const MENSAJE_SERVIDOR_DE_JUEGO = /^AYK/;
const DIRECCION = /([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/g;

/*
 * El protocolo separa los campos con | y con coma, y el texto largo viaja
 * CODIFICADO EN PORCENTAJES: la descripcion de un temperamento llega como
 * "%2B10%20%25%20de%20puissance%2C%20-10%20%25%20de%20r%C3%A9sistance". Buscar
 * el frances en la cadena cruda no encuentra nada, y ese era el motivo de que
 * el diccionario no casara con nada del servidor.
 *
 * Asi que se trabaja campo a campo: el que viene codificado se descodifica, se
 * traduce y se vuelve a codificar -- y ahi una traduccion puede llevar comas
 * sin peligro, porque acaban como %2C. El campo en claro solo admite
 * traducciones sin separadores, o partiria el mensaje en dos.
 */
/*
 * El punto y coma TIENE que estar aqui. Separa registros -- un hechizo de otro
 * en la lista de un Dofemon -- y si no se trocea por el queda dentro de un
 * campo; al recodificarlo se convierte en %3B y el cliente deja de verlo como
 * separador. El sintoma no apuntaba a esto en absoluto: de tres hechizos salia
 * uno, y en su sitio "Hechizo NaN" y "undefined".
 *
 * La regla: hay que trocear por todo separador que encodeURIComponent escape.
 * La virgulilla no lo necesita -- no la escapa -- pero se trocea igual porque
 * tambien separa.
 */
const CAMPOS = /([|,~;]|(?<=[^ ]):(?=[^ ]))/;
const SEPARADORES_EN_CLARO = /[|,;~\n\x00]/;

/*
 * Los dos puntos son separador en unos mensajes y puntuacion en otros. En el
 * de la panoplia van pegados -- "COIFFE:Coiffe:Savoir" -- y meter uno partiria
 * el mensaje; en el texto de un efecto van con espacios -- "Dommages : 10" -- y
 * la traduccion oficial los necesita: "Daños: 10".
 *
 * Se decide por mensaje: si hay algun ":" pegado a caracteres, manda como
 * separador y no se admite ninguna traduccion que lleve uno.
 */
const DOS_PUNTOS_PEGADOS = /[^\s]:[^\s]/;

/* encodeURIComponent deja fuera la comilla simple, que el servidor si codifica.
 * Se anade a mano para devolver el campo tal y como lo esperaria el cliente. */
/* Quita las tildes para poder comparar nombres escritos de dos maneras. */
const MARCAS_DIACRITICAS = /[̀-ͯ]/g;

function sinAcentos(texto) {
  return texto.normalize('NFD').replace(MARCAS_DIACRITICAS, '');
}

/*
 * Clave para comparar dos escrituras del mismo nombre.
 *
 * Se ignoran tildes Y mayusculas. El diccionario sale de un archivo del juego y
 * el servidor manda otro texto, y no siempre coinciden en eso: el hechizo
 * figuraba como "Pierre qui roule n'amasse pas mousse" y llegaba con "Mousse".
 * Sin esto quedaba a medias, con la primera palabra traducida y el resto en
 * frances.
 */
function claveDeNombre(texto) {
  return sinAcentos(texto).toLowerCase();
}

function codificar(texto) {
  return encodeURIComponent(texto).replace(/'/g, '%27');
}

/*
 * cargar() devuelve { frases, nombres }. La distincion no es cosmetica: los
 * nombres son catorce mil y llegan siempre como un campo entero, asi que van a
 * un indice de consulta exacta; las frases hay que buscarlas dentro del texto y
 * son unos pocos miles. Meter los nombres en la busqueda por subcadena costaba
 * dos milisegundos por mensaje, que en combate se nota.
 */
function crearTraductor(cargar, apuntarDesconocida) {
  /* Las claves se ordenan de mas larga a mas corta: si no, traducir "Combat"
   * dentro de "Combat de dresseur" dejaria la frase a medias. */
  let todas = [];
  let seguras = [];
  let sinDosPuntos = [];
  let libres = [];
  let firma = null;

  /*
   * El diccionario tiene dos partes con costes muy distintos: catorce mil
   * NOMBRES, que llegan siempre como un campo entero, y unos miles de FRASES,
   * que hay que buscar dentro del texto. Recorrer los catorce mil buscando
   * subcadena en cada campo de cada mensaje seria un desperdicio, asi que los
   * nombres van a un indice de busqueda exacta -- una consulta por campo -- y
   * solo las frases se recorren.
   */
  let exactas = new Map();
  let normalizadas = new Map();
  let porPrimeraPalabra = new Map();

  /*
   * El diccionario se recarga en caliente para poder anadir traducciones sin
   * cerrar el juego, pero comprobarlo en CADA mensaje costaba mas que traducir:
   * son dieciseis mil claves que enumerar. Con mirar cada pocos segundos basta y
   * sobra -- nadie edita el diccionario a mitad de un combate.
   */
  const ESPERA_ENTRE_RECARGAS = 5000;
  let ultimaMirada = 0;

  const refrescar = function () {
    const ahora = Date.now();
    if (ahora - ultimaMirada < ESPERA_ENTRE_RECARGAS) return;
    ultimaMirada = ahora;

    const fuentes = cargar();
    const diccionario = fuentes.frases || {};
    const nombres = fuentes.nombres || {};
    const nuevaFirma = Object.keys(diccionario).length + Object.keys(nombres).length;
    if (nuevaFirma === firma) return;

    firma = nuevaFirma;
    exactas = new Map(Object.entries(nombres));
    for (const [clave, valor] of Object.entries(diccionario)) exactas.set(clave, valor);

    /*
     * El servidor y los archivos de idioma no siempre escriben igual el mismo
     * nombre: el servidor manda "Rat d'Égoutant" y el archivo lo tiene como
     * "Rat d'Egoutant". Una tilde de diferencia bastaba para que no se
     * encontrara.
     *
     * Se indexan TODAS las claves por su forma sin acentos -- no solo las que
     * llevan tilde, que era el error: la clave del archivo es justamente la que
     * NO la lleva, y la consulta viene con ella.
     *
     * Si dos nombres distintos se normalizan igual pero se traducen distinto,
     * se descartan los dos: preferible dejarlo en frances que elegir mal.
     */
    normalizadas = new Map();
    const chocan = new Set();

    for (const [clave, valor] of exactas) {
      const llave = claveDeNombre(clave);
      const previo = normalizadas.get(llave);
      if (previo !== undefined && previo !== valor) { chocan.add(llave); continue; }
      normalizadas.set(llave, valor);
    }

    for (const llave of chocan) normalizadas.delete(llave);

    todas = Object.keys(diccionario)
      .filter(function (clave) { return clave && !SEPARADORES.test(diccionario[clave]); })
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (clave) {
        return [clave, diccionario[clave], esPalabraSuelta(clave), sinAcentos(clave)];
      });

    seguras = todas.filter(function (par) { return !SEPARADORES_EN_CLARO.test(par[1]); });
    sinDosPuntos = seguras.filter(function (par) { return par[1].indexOf(':') === -1; });

    /* El texto libre admite comas y puntos, solo la barra partiria el mensaje.
     * Se precalcula: filtrar dos mil entradas en cada mensaje de chat era el
     * grueso del coste del traductor. */
    libres = todas.filter(function (par) { return par[1].indexOf('|') === -1; });

    /*
     * En el chat los nombres van DENTRO de la frase -- "Colmillo mellado
     * llevado por Rat d'Égoutant." -- asi que la consulta exacta por campo no
     * los alcanza. Buscarlos como subcadena seria recorrer catorce mil por
     * mensaje, de modo que se indexan por su PRIMERA PALABRA: en la frase solo
     * se prueban los nombres que empiezan por la palabra que hay en cada
     * posicion, que son un punado.
     */
    porPrimeraPalabra = new Map();

    for (const [nombre, traduccion] of Object.entries(nombres)) {
      const primera = nombre.split(' ')[0];
      if (!primera) continue;

      const llave = claveDeNombre(primera);
      const lista = porPrimeraPalabra.get(llave) || [];
      lista.push([nombre, traduccion]);
      porPrimeraPalabra.set(llave, lista);
    }

    // De mas largo a mas corto: "Petit Bouftou" antes que "Petit".
    for (const lista of porPrimeraPalabra.values()) {
      lista.sort(function (a, b) { return b[0].length - a[0].length; });
    }
  };

  /* Recorre la frase palabra a palabra y sustituye los nombres que empiezan
   * justo ahi. Sin acentos como respaldo, igual que la consulta exacta. */
  const sustituirNombres = function (texto) {
    if (porPrimeraPalabra.size === 0) return texto;

    let salida = '';
    let resto = texto;

    while (resto.length) {
      const corte = resto.search(/[A-Za-zÀ-ÿ]/);
      if (corte === -1) { salida += resto; break; }

      salida += resto.slice(0, corte);
      resto = resto.slice(corte);

      const palabra = /^[A-Za-zÀ-ÿ0-9'’-]+/.exec(resto)[0];
      const candidatos = porPrimeraPalabra.get(claveDeNombre(palabra)) || [];
      let encontrado = null;

      /*
       * Gana la coincidencia MAS LARGA, y a igualdad de longitud la exacta.
       *
       * Las dos cosas hacen falta. Sin lo primero, "Pierre" se comia el hechizo
       * "Pierre qui roule n'amasse pas mousse". Sin lo segundo, el diccionario
       * automatico trae el mismo sitio escrito de dos maneras -- "Le berceau" y
       * "Le Berceau" -- y al medir igual ganaba el que saliera antes, que podia
       * ser el mal escrito y no la correccion hecha a mano.
       *
       * La lista ya viene ordenada de mas larga a mas corta, asi que basta con
       * quedarse con la primera que casa y, entre las de su mismo tamano,
       * preferir la que coincide letra por letra.
       */
      for (const [nombre, traduccion] of candidatos) {
        const exacta = resto.startsWith(nombre);

        const unaPalabra = nombre.indexOf(' ') === -1;
        const mismaInicial = !unaPalabra || resto[0] === nombre[0] ||
          (resto[0] === resto[0].toUpperCase()) === (nombre[0] === nombre[0].toUpperCase());

        const laxa = mismaInicial &&
          claveDeNombre(resto.slice(0, nombre.length)) === claveDeNombre(nombre);

        if (!exacta && !laxa) continue;

        // Una mas corta no puede ganarle a la que ya se encontro.
        if (encontrado && nombre.length < encontrado.largo) break;

        // Ya habia una de este mismo tamano y era exacta: se queda aquella.
        if (encontrado && encontrado.largo === nombre.length && !exacta) continue;

        encontrado = { largo: nombre.length, traduccion: traduccion, exacta: exacta };
        if (exacta) break;
      }

      if (encontrado) {
        salida += encontrado.traduccion;
        resto = resto.slice(encontrado.largo);
      } else {
        salida += palabra;
        resto = resto.slice(palabra.length);
      }
    }

    return salida;
  };

  /*
   * La mayoria de los campos de un mensaje son numeros -- ids, niveles, puntos
   * de vida -- y recorrerles dos mil frases buscando subcadena es tiempo tirado.
   * Un campo sin letras, o mas corto que la frase mas corta, no puede contener
   * nada que traducir.
   */
  const PUEDE_LLEVAR_TEXTO = /[A-Za-zÀ-ÿ]{3}/;

  /*
   * Una letra es la unica clase de caracter que cambia al pasar a mayuscula, y
   * eso vale igual para las acentuadas. Sale mas corto y mas seguro que una
   * lista de rangos.
   */
  const esLetra = function (c) { return c !== undefined && c.toLowerCase() !== c.toUpperCase(); };

  const esPalabraSuelta = function (texto) {
    for (const c of texto) if (!esLetra(c)) return false;
    return true;
  };

  /*
   * Busca la frase sin mirar las tildes y la cambia en el texto original.
   *
   * El servidor no es coherente con los acentos: manda "Dégâts neutres" en un
   * mensaje y "+1 case de portee en moins" en otro. El diccionario sale de los
   * archivos del juego, que si los llevan, asi que la mitad de las frases no
   * casaban y salian cosas como "+1 case de alcance en moins" -- traducida solo
   * la palabra que por casualidad coincidia.
   *
   * Se compara sobre una copia sin tildes y se corta sobre el texto de verdad,
   * que mide lo mismo. Si por lo que sea no midiera lo mismo, se compara tal
   * cual: mejor no traducir que cortar por donde no es.
   *
   * Y si la entrada es una palabra suelta, solo entra cuando va suelta: sin eso
   * "Songe" convertiria "Mensonge" en "MenSueño".
   */
  const sustituirUna = function (texto, origen, destino, suelta) {
    const llano = sinAcentos(texto);
    const buscado = llano.length === texto.length ? sinAcentos(origen) : origen;
    const referencia = llano.length === texto.length ? llano : texto;

    let salida = '';
    let desde = 0;

    for (;;) {
      const i = referencia.indexOf(buscado, desde);
      if (i === -1) return salida + texto.slice(desde);

      const fin = i + buscado.length;
      const pegada = suelta && (esLetra(texto[i - 1]) || esLetra(texto[fin]));
      salida += texto.slice(desde, i) + (pegada ? texto.slice(i, fin) : destino);
      desde = fin;
    }
  };

  const sustituir = function (texto, tabla) {
    if (!PUEDE_LLEVAR_TEXTO.test(texto)) return texto;

    let salida = texto;
    let llano = sinAcentos(salida);

    for (const [origen, destino, suelta, sinTildes] of tabla) {
      if (llano.indexOf(sinTildes) === -1) continue;

      const antes = salida;
      salida = sustituirUna(salida, origen, destino, suelta);
      if (salida !== antes) llano = sinAcentos(salida);
    }

    return salida;
  };

  /* Solo se apunta lo que parece frances de verdad: el trafico lleva nombres de
   * jugador, numeros y coordenadas, y anotarlo todo haria el informe inutil. */
  const FRANCES = /[àâçèêëîïôùûœ]|\b(vous|votre|nous|des|une|est|dans|pour|avec|sur|par|plus|tout|mais|donc|pas|cette|aux|qui|que|elle|ses|son|sa|les|le|la|du|de|et|ne|se|au)\b/i;

  /*
   * Marcas del espanol. Sirven para NO apuntar lo que ya esta traducido: el
   * trafico lleva mucho texto correcto y anotarlo todo enterraria lo que
   * importa.
   */
  const ESPANOL = /[ñ¿¡]|\b(los|las|una|del|con|para|por|que|más|pero|desde|hasta|cuando|donde|este|esta|estos|estas|tus|sus|muy|todo|toda|puedes|tiene|hacia|entre)\b/i;

  /*
   * Se apunta TODO lo que no se supo traducir y parece texto, no solo lo que
   * lleva tilde. El detector estrecho se dejaba fuera frases enteras sin
   * acentos -- "Poison paralysant", "Ni bonus ni malus" -- y esas eran
   * justamente las que seguian saliendo en frances. Sobra material en el
   * informe antes que faltar: filtrarlo despues es trivial, adivinar que falta
   * no lo es.
   */
  const PARECE_TEXTO = /[A-Za-zÀ-ÿ]{3}/;

  const anotarSiEsFrances = function (campo) {
    if (!apuntarDesconocida) return;
    if (campo.length < 4 || !PARECE_TEXTO.test(campo)) return;
    if (!FRANCES.test(campo) && ESPANOL.test(campo)) return;
    apuntarDesconocida(campo);
  };

  /*
   * Punto ciego que costo caro: solo se apuntaba lo que no se habia tocado.
   *
   * Una frase que el diccionario traduce A MEDIAS -- porque casan dos fragmentos
   * y el resto no -- salia cambiada, asi que se daba por buena y no se apuntaba
   * en ningun sitio. Y son justo las peores de leer: "cette région ouvrira con
   * son chapitre", medio en frances y medio en espanol. Solo aparecian cuando el
   * jugador se molestaba en copiarlas a mano.
   *
   * Ahora se mira el RESULTADO: si despues de traducir sigue teniendo marcas de
   * frances, se apunta el original. Con una senal delante para distinguirlas de
   * las que no se tocaron.
   */
  const anotarSiQuedaFrances = function (original, resultado) {
    if (!apuntarDesconocida) return;
    if (resultado === original) return anotarSiEsFrances(original);
    if (original.length < 8 || !FRANCES.test(resultado)) return;
    apuntarDesconocida('A MEDIAS: ' + original);
  };

  /*
   * En los mensajes de chat la coma NO separa campos: forma parte de la frase.
   * Trocearlos por coma partia el texto en mitades y ninguna casaba con el
   * diccionario -- llegaban cosas como "Des caisses alignees le long du mur" por
   * un lado y " et pas une qui porte la marque d'un marchand" por otro. Ahi se
   * traduce el mensaje entero de una pieza.
   */
  const TEXTO_LIBRE = /^cs|^cMK|<font/;

  /*
   * Un campo entero en mayusculas y sin espacios no es texto: es un token de
   * estado del protocolo -- ACTIVE, RESERVE, KO -- y el cliente lo compara letra
   * a letra.
   *
   * Esto costo dos fallos en combate que no parecian de traduccion. En un SWF hay
   * una etiqueta "RESERVE" con acento, y como el indice sin acentos busca la
   * clave sin tildes, el token RESERVE del protocolo caia justo encima y salia
   * traducido como RESERVA. El cliente cuenta los RESERVE para saber cuantos
   * monstruos quedan y mira ese mismo valor para decidir a quien puedes sacar al
   * cambiar: con RESERVA no reconocia ninguno, asi que el contador salia vacio y
   * los Dofemons del cambio aparecian apagados.
   *
   * La estructura del mensaje quedaba intacta -- mismos separadores, mismos
   * numeros -- por eso la comprobacion no lo veia.
   */
  const TOKEN_DEL_PROTOCOLO = /^[A-Z][A-Z0-9_-]+$/;

  /* Una palabra suelta, sin nada que la acompane: ya la vio la consulta exacta. */
  const TOKEN_SUELTO = /^[A-Za-zÀ-ÿ0-9_-]+$/;

  /*
   * Una clave interna: todo en minuscula, sin espacios ni acentos, con puntos o
   * guiones para separar. Asi nombra Pokefus sus zonas -- "brakmar",
   * "amakna.champ-du-repos", "tainela.donjon-bouftous" -- y el cliente las busca
   * tal cual.
   *
   * Se descubrio traduciendo: la busqueda que ignora mayusculas hacia que
   * "brakmar" casara con el nombre propio "Brakmar", y el mensaje salia con la
   * clave en mayuscula. La estructura quedaba intacta -- misma cantidad de
   * campos, mismos numeros -- asi que la comprobacion no lo veia, pero el
   * cliente ya no reconocia la zona.
   *
   * El texto de pantalla nunca tiene esta forma: lleva mayusculas, espacios o
   * tildes. Asi que si un campo entero encaja aqui, es una clave y no se toca.
   */
  const CLAVE_INTERNA = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

  /*
   * Retoques que no caben en un diccionario porque llevan numeros dentro.
   * "Dommages : 6 à 8" no se puede meter como entrada: el rango cambia en cada
   * hechizo. Y " a " suelto no se puede traducir sin mas -- salio un "ya estas
   * enu zaap" por hacerlo -- asi que solo se cambia entre dos cifras, que es
   * donde siempre significa "de X a Y".
   */
  const RETOQUES = [
    [/([0-9]) à (-?[0-9])/g, '$1 a $2'],

    /*
     * La contraccion del articulo. Los nombres de sitio llevan el articulo
     * dentro -- "el pueblo costero", "El Cementerio de los Torturados" -- y al
     * meterlos en una frase salia "en el zaap de el pueblo costero". En espanol
     * eso no se escribe asi ni se dice asi.
     */
    [/\bde [Ee]l /g, 'del '],
    [/\ba [Ee]l /g, 'al '],

    /*
     * "150 sur 150" es un marcador y en espanol se dice "150 de 150". Estaba
     * puesto en el diccionario como " sur " -> " de ", y asi se comia el "sur"
     * de cualquier otra frase: "Aucune creature capturable sur cette case"
     * salia "... de cette case". Aqui va pegado a las cifras, que es el unico
     * sitio donde significa eso.
     */
    [/([0-9]) sur ([0-9])/g, '$1 de $2'],
  ];

  const retocar = function (texto) {
    let salida = texto;
    for (const [patron, cambio] of RETOQUES) salida = salida.replace(patron, cambio);
    return salida;
  };

  return function (texto) {
    refrescar();

    if (TEXTO_LIBRE.test(texto)) {
      const traducido = retocar(sustituirNombres(sustituir(texto, libres)));

      anotarSiQuedaFrances(texto, traducido);
      return traducido;
    }

    const tablaEnClaro = DOS_PUNTOS_PEGADOS.test(texto) ? sinDosPuntos : seguras;

    return texto.split(CAMPOS).map(function (campo) {
      if (campo === undefined) return '';
      if (campo.length === 1 && /[|,~;:]/.test(campo)) return campo;
      if (TOKEN_DEL_PROTOCOLO.test(campo)) return campo;
      if (CLAVE_INTERNA.test(campo)) return campo;

      if (campo.indexOf('%') === -1) {
        // Un nombre ocupa el campo entero: una consulta al indice y listo.
        const exacta = exactas.get(campo) !== undefined
          ? exactas.get(campo)
          : normalizadas.get(claveDeNombre(campo));
        if (exacta !== undefined && !SEPARADORES_EN_CLARO.test(exacta)) return exacta;

        /*
         * Los nombres van PRIMERO. Un nombre compuesto como "Armure Terrestre"
         * lleva dentro palabras que tambien estan en el diccionario de frases,
         * y aplicar las frases antes lo dejaba en "Armure Tierrastre". Traducido
         * el nombre entero, ya no hay nada dentro que tocar.
         */
        /*
         * Buscar nombres DENTRO del campo solo si el campo lleva algo mas que
         * una palabra suelta. Una palabra sola ya la ha mirado la consulta
         * exacta de arriba; volver a recorrerla por dentro solo puede pisar un
         * valor del protocolo.
         *
         * Lo que si hay que mirar por dentro son los campos compuestos, que no
         * llevan espacios pero tampoco son un token: "522.5.1.Martelement.37"
         * trae el nombre del hechizo metido entre puntos. Pedir un espacio
         * dejaba todos esos en frances.
         */
        const conNombres = TOKEN_SUELTO.test(campo) ? campo : sustituirNombres(campo);

        const traducido = retocar(sustituir(conNombres, tablaEnClaro));
        anotarSiQuedaFrances(campo, traducido);
        return traducido;
      }

      let claro;
      try { claro = decodeURIComponent(campo); }
      catch (error) { return sustituir(campo, tablaEnClaro); } // no era una codificacion valida

      const exacta = exactas.get(claro) !== undefined
        ? exactas.get(claro)
        : normalizadas.get(claveDeNombre(claro));
      if (exacta !== undefined) return codificar(exacta);

      /*
       * Los nombres, tambien aqui dentro.
       *
       * Esta rama -- la de los campos codificados con %XX -- solo miraba la
       * tabla de frases, asi que un campo compuesto como
       * "522.5.1.Martelement.37", que viaja codificado dentro de la ficha del
       * Dofemon, se quedaba con el nombre del hechizo en frances aunque el
       * diccionario lo tuviera. La consulta exacta de arriba no lo alcanza
       * porque el nombre es solo un trozo del campo.
       */
      const conNombres = TOKEN_SUELTO.test(claro) ? claro : sustituirNombres(claro);

      const traducido = retocar(sustituir(conNombres, todas));
      anotarSiQuedaFrances(claro, traducido);
      return traducido === claro ? campo : codificar(traducido);
    }).join('');
  };
}

/*
 * Trocea el flujo por el separador y traduce cada mensaje completo. Lo que
 * quede a medias se guarda para el trozo siguiente: un mensaje puede llegar
 * partido en dos paquetes TCP y traducir medio mensaje seria destrozarlo.
 */
function crearFiltro(separador, traducir, reescribirDirecciones, espiar) {
  let resto = Buffer.alloc(0);

  return function (trozo) {
    const datos = Buffer.concat([resto, trozo]);
    const piezas = [];
    let inicio = 0;

    for (let i = 0; i < datos.length; i++) {
      if (datos[i] !== separador) continue;

      const mensaje = datos.toString('utf8', inicio, i);
      if (espiar) espiar(mensaje);
      let traducido = traducir(mensaje);
      if (reescribirDirecciones) traducido = reescribirDirecciones(traducido);

      piezas.push(Buffer.from(traducido, 'utf8'), Buffer.from([separador]));
      inicio = i + 1;
    }

    resto = datos.subarray(inicio);
    return Buffer.concat(piezas);
  };
}

/*
 * Cada destino que anuncie el servidor recibe su propio puerto local, y se
 * reutiliza si vuelve a anunciarse.
 *
 * LOS PUERTOS SE RESERVAN POR ADELANTADO. La direccion del servidor de juego se
 * anuncia UNA sola vez, en un mensaje que ya va de camino cuando lo leemos:
 * abrir el puerto en ese momento llega tarde -- listen() es asincrono -- y ese
 * unico mensaje pasaria sin tocar, que es exactamente lo que ocurria. Con un
 * puñado de puertos ya escuchando, asignar uno es inmediato: el destino se
 * decide al aceptar la conexion, que sucede despues.
 */
const PUERTOS_DE_RESERVA = 8;

function crearRedirector(traducir, anotar) {
  const reserva = [];
  const asignados = new Map();

  const preparar = function () {
    const promesas = [];

    for (let i = 0; i < PUERTOS_DE_RESERVA; i++) {
      const plaza = { host: null, puerto: null };

      promesas.push(escuchar(
        function () { return plaza; }, traducir, anotar, null).then(function (servicio) {
        plaza.local = servicio.port;
        reserva.push(plaza);
      }));
    }

    return Promise.all(promesas);
  };

  /*
   * El opcode se aparta antes de buscar: "AYKgame.pokefus.org" es un nombre de
   * host valido para el patron, y dejarlo dentro se llevaba las tres letras por
   * delante -- el cliente recibia una direccion sin mensaje que la nombrara.
   */
  const reescribir = function (mensaje) {
    if (!MENSAJE_SERVIDOR_DE_JUEGO.test(mensaje)) return mensaje;

    return 'AYK' + mensaje.slice(3).replace(DIRECCION, function (entero, host, puerto) {
      const clave = host + ':' + puerto;

      if (asignados.has(clave)) return '127.0.0.1:' + asignados.get(clave);
      if (!reserva.length) { anotar('sin puertos de reserva para ' + clave); return entero; }

      const plaza = reserva.shift();
      plaza.host = host;
      plaza.puerto = Number(puerto);
      asignados.set(clave, plaza.local);

      anotar('redireccion ' + clave + ' -> 127.0.0.1:' + plaza.local);
      return '127.0.0.1:' + plaza.local;
    });
  };

  return { preparar: preparar, reescribir: reescribir };
}

/*
 * El destino se pide en el momento de aceptar la conexion, no al crear el
 * servidor: asi un puerto de reserva puede quedarse esperando y saber a donde
 * va solo cuando alguien llama.
 */
/*
 * Espia opcional: vuelca los mensajes del servidor a un archivo cuando existe
 * tm/debug-proxy. Sirve para averiguar en que formato viaja algo -- la
 * direccion del servidor de juego, por ejemplo -- sin adivinar. Se activa
 * creando el archivo y se apaga borrandolo.
 */
function crearEspia(anotar) {
  const path = require('path');
  const marca = path.join(__dirname, '..', 'tm', 'debug-proxy');
  if (!fs.existsSync(marca)) return null;

  const destino = path.join(__dirname, '..', 'proxy.log');
  anotar('espia activo -> proxy.log');

  return function (mensaje) {
    try { fs.appendFileSync(destino, JSON.stringify(mensaje) + '\n'); } catch (error) { /* */ }
  };
}

function escuchar(destinoDe, traducir, anotar, redirector) {
  const espiar = crearEspia(anotar);

  return new Promise(function (resolve, reject) {
    const servidor = net.createServer(function (cliente) {
      const destino = destinoDe();

      if (!destino || !destino.host) {
        anotar('conexion a un puerto de reserva sin destino, se corta');
        cliente.destroy();
        return;
      }

      anotar('conexion entrante -> ' + destino.host + ':' + destino.puerto);
      const arriba = net.connect(destino.puerto, destino.host);

      const filtro = crearFiltro(SEPARADOR_SERVIDOR, traducir, redirector, espiar);

      arriba.on('data', function (trozo) {
        try {
          cliente.write(filtro(trozo));
        } catch (error) {
          anotar('traduccion fallida, se deja pasar: ' + error.message);
          cliente.write(trozo);
        }
      });

      // Del cliente al servidor no se toca nada: son ordenes, no texto.
      cliente.on('data', function (trozo) { arriba.write(trozo); });

      const cerrar = function () { cliente.destroy(); arriba.destroy(); };
      cliente.on('error', cerrar);
      arriba.on('error', cerrar);
      cliente.on('close', cerrar);
      arriba.on('close', cerrar);
    });

    servidor.on('error', reject);
    servidor.listen(0, '127.0.0.1', function () {
      resolve({ servidor: servidor, port: servidor.address().port });
    });
  });
}

/*
 * Arranca el proxy del servidor de conexion y devuelve su puerto local. Los
 * puertos de reserva se abren ANTES de aceptar al cliente, para que la
 * direccion del servidor de juego se pueda sustituir en cuanto aparezca.
 */
function start(hostDestino, puertoDestino, cargarDiccionario, anotar, apuntarDesconocida) {
  const traducir = crearTraductor(cargarDiccionario, apuntarDesconocida);
  const redirector = crearRedirector(traducir, anotar);
  const conexion = { host: hostDestino, puerto: puertoDestino };

  return redirector.preparar().then(function () {
    return escuchar(function () { return conexion; }, traducir, anotar, redirector.reescribir);
  });
}

module.exports = { start, crearTraductor, crearFiltro };
