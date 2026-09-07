'use strict';

/*
 * Traduccion de la capa HTML del cliente.
 *
 * El juego no es solo Flash: el panel lateral, el mapa y el chat los dibuja
 * Electron en HTML, con el texto en frances escrito en el codigo. No hay
 * archivo de idioma que interceptar, asi que se traduce la pagina ya montada.
 *
 * Se hace en el navegador y no reescribiendo los fuentes por dos razones: esos
 * archivos los restaura el launcher en cada actualizacion, y buena parte del
 * texto se crea sobre la marcha, cuando el jugador abre una pestana o llega un
 * mensaje. Un observador cubre las dos cosas sin depender de la version.
 *
 * Ademas apunta lo que ve en frances y no sabe traducir. Asi, cuando Pokefus
 * anada una pantalla nueva, no hay que ir a buscarla: aparece sola en
 * tm/dom-desconocidas.json.
 */

const AVISO = '[pokefus-es]';

/*
 * El guion se inyecta como texto en cada ventana, de modo que se escribe como
 * una funcion que se serializa. No puede cerrar sobre nada de aqui: el
 * diccionario viaja como argumento.
 */
function guionInyectado(diccionario, fragmentos, aviso) {
  const tabla = new Map(Object.entries(diccionario));

  /*
   * Algunos textos se componen sobre la marcha -- "Position 5, -17 carte 7573"
   * lleva dentro numeros que cambian -- y no hay forma de que coincidan con una
   * entrada exacta. Para esos hay una segunda tabla que se busca DENTRO del
   * texto. Va aparte y no mezclada porque buscar por dentro es mas caro y mas
   * arriesgado: solo entra ahi lo que de verdad lo necesita.
   */
  /*
   * Se comparan sin tildes y sin distinguir mayusculas.
   *
   * El servidor no es coherente: manda "La Péninsule des Gelées" en un sitio y
   * "La péninsule des Gelées" en otro. Con la comparacion literal, la mitad de
   * los nombres del mapa se quedaban en frances y habia que ir apuntando cada
   * variante a mano.
   *
   * El texto se corta sobre el original, que mide lo mismo que su version sin
   * tildes; si por lo que sea no midiera lo mismo, se compara tal cual.
   */
  const MARCAS = /[\u0300-\u036f]/g;
  const llanear = function (texto) {
    return texto.normalize('NFD').replace(MARCAS, '').toLowerCase();
  };

  const trozos = Object.entries(fragmentos)
    .sort(function (a, b) { return b[0].length - a[0].length; })
    .map(function (par) { return [par[0], par[1], llanear(par[0])]; });

  const cambiarTrozo = function (texto, origen, destino, llano) {
    const referencia = llanear(texto);
    if (referencia.length !== texto.length) {
      return texto.indexOf(origen) === -1 ? texto : texto.split(origen).join(destino);
    }

    let salida = '';
    let desde = 0;

    for (;;) {
      const i = referencia.indexOf(llano, desde);
      if (i === -1) return salida + texto.slice(desde);

      salida += texto.slice(desde, i) + destino;
      desde = i + llano.length;
    }
  };

  /* Solo se avisa de lo que parece frances de verdad, o el informe se llenaria
   * de nombres de jugador, numeros y texto ya traducido. */
  const ACENTOS = /[àâçèéêëîïôùûœ]/;
  const PALABRAS = /\b(vous|votre|nous|des|une|est|dans|pour|avec|sur|par|plus|tout|mais|donc|pas|cette|aux|qui|que|jeu|joueur|aucun|aucune|fermer|ouvrir|envoyer|rechercher|afficher|masquer|retour|suivant|annuler|niveau|monde|carte|zone|serveur|combat|guilde|groupe|canal|message)\b/i;
  const desconocidas = new Set();

  const pareceFrances = function (texto) {
    return /[A-Za-zÀ-ÿ]{3}/.test(texto) && (ACENTOS.test(texto) || PALABRAS.test(texto));
  };

  const traducir = function (texto) {
    const limpio = texto.trim();
    if (!limpio) return null;

    const puesto = tabla.get(limpio);
    if (puesto !== undefined) return texto.replace(limpio, puesto);

    let porTrozos = texto;
    for (const [origen, destino, llano] of trozos) {
      porTrozos = cambiarTrozo(porTrozos, origen, destino, llano);
    }
    if (porTrozos !== texto) return porTrozos;

    if (pareceFrances(limpio) && !desconocidas.has(limpio)) {
      desconocidas.add(limpio);
      console.log(aviso + ' SIN TRADUCIR ' + JSON.stringify(limpio));
    }

    return null;
  };

  const ATRIBUTOS = ['placeholder', 'title', 'alt', 'aria-label'];

  const traduceElemento = function (elemento) {
    for (const nombre of ATRIBUTOS) {
      const valor = elemento.getAttribute && elemento.getAttribute(nombre);
      if (!valor) continue;

      const nuevo = traducir(valor);
      if (nuevo !== null) elemento.setAttribute(nombre, nuevo);
    }

    // Un input de boton lleva su etiqueta en value, no en el texto.
    if (elemento.tagName === 'INPUT' && (elemento.type === 'button' || elemento.type === 'submit')) {
      const nuevo = traducir(elemento.value || '');
      if (nuevo !== null) elemento.value = nuevo;
    }
  };

  /*
   * Solo nodos de texto: tocar innerHTML volveria a crear los hijos y dejaria
   * sin escuchadores los botones que el cliente ya habia enganchado.
   */
  const traduceRama = function (raiz) {
    if (raiz.nodeType === Node.TEXT_NODE) {
      const nuevo = traducir(raiz.nodeValue);
      if (nuevo !== null) raiz.nodeValue = nuevo;
      return;
    }

    if (raiz.nodeType !== Node.ELEMENT_NODE) return;

    traduceElemento(raiz);

    const paseo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT);
    let nodo = paseo.nextNode();

    while (nodo) {
      if (nodo.nodeType === Node.TEXT_NODE) {
        const nuevo = traducir(nodo.nodeValue);
        if (nuevo !== null) nodo.nodeValue = nuevo;
      } else {
        traduceElemento(nodo);
      }
      nodo = paseo.nextNode();
    }
  };

  traduceRama(document.documentElement);

  /*
   * Lo que llega despues: pestanas que se abren, mensajes de chat, infobulbas.
   * Se observa el documento entero porque el cliente monta y desmonta trozos
   * enteros de panel, y suscribirse solo a los contenedores de ahora dejaria
   * fuera los que cree luego.
   */
  const observador = new MutationObserver(function (cambios) {
    for (const cambio of cambios) {
      if (cambio.type === 'characterData') {
        const nuevo = traducir(cambio.target.nodeValue);
        if (nuevo !== null) cambio.target.nodeValue = nuevo;
        continue;
      }

      if (cambio.type === 'attributes') {
        traduceElemento(cambio.target);
        continue;
      }

      for (const nodo of cambio.addedNodes) traduceRama(nodo);
    }
  });

  observador.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATRIBUTOS.concat(['value']),
  });

  return tabla.size;
}

/*
 * Se engancha por webContents y no por ventana: el panel lateral y el chat no
 * son ventanas aparte sino un webview dentro de la del juego, y escuchando solo
 * la creacion de ventanas se quedaban en frances.
 *
 * En dom-ready y no en did-finish-load: la pagina ya esta montada y traducirla
 * ahi evita ver el frances parpadear antes del cambio.
 */
function instalarEnVentana(contenido, diccionario, fragmentos, anotar, apuntarDesconocida) {
  contenido.on('console-message', function (evento, nivel, mensaje) {
    const marca = AVISO + ' SIN TRADUCIR ';
    if (mensaje.indexOf(marca) !== 0) return;

    try {
      apuntarDesconocida(JSON.parse(mensaje.slice(marca.length)));
    } catch (error) { /* un mensaje mal formado no merece tumbar nada */ }
  });

  contenido.on('dom-ready', function () {
    const codigo = '(' + guionInyectado.toString() + ')(' +
      JSON.stringify(diccionario) + ',' + JSON.stringify(fragmentos) + ',' +
      JSON.stringify(AVISO) + ')';

    contenido.executeJavaScript(codigo, true)
      .then(function (cuantas) { anotar('DOM traducido (' + cuantas + ' entradas) en ' + contenido.getURL()); })
      .catch(function (error) { anotar('DOM fallo: ' + error.message); });
  });
}

module.exports = { instalarEnVentana };
