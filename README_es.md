# pokefus-es

Pokefus en español.

**Traducido por: ikary**

## Pasarselo a otra persona

`node empaquetar.js` deja en `dist/pokefus-es` una carpeta lista para comprimir.
Se descomprime al lado de `Pokefus UpLauncher` y se abre `Pokefus en espanol.bat`.

No hace falta instalar Node: el .bat usa el Electron que trae el propio juego
como interprete (`ELECTRON_RUN_AS_NODE`). Y la instalacion se localiza sola
(`src/instalacion.js`), no hay rutas escritas a mano.

**El paquete no lleva `backup/` ni `cache/`.** Los backups son los archivos
originales de ESTA instalacion; restaurarlos en otro ordenador, con otra version
del cliente, se lo dejaria roto. Alla se crean solos la primera vez.

## Uso

    node aplicar.js          pone la traducción
    node aplicar.js quitar   deja el cliente como estaba

Después arranca el juego normalmente. **Hay que volver a ejecutar `node aplicar.js`
después de cada actualización del launcher**, y solo por eso: el updater lleva el
sha256 de cada archivo y restaura los que tocamos dentro de la instalación.
Todo lo demás se traduce al vuelo.

## Las tres capas

El texto del juego no está en un sitio, está en tres, y cada uno pide una vía
distinta:

| Dónde | Qué se ve | Cómo se traduce |
|---|---|---|
| `loader.swf` (local) | pantalla de conexión, selección de mundo | se parchea el archivo en disco |
| `modules/core.swf` (local) | equipo, misiones, renombre, mochila, panoplia, Kolizeum | se parchea el archivo en disco |
| Archivos de idioma (de `pokefus.org`) | objetos, hechizos, misiones, diálogos, vocaciones | se interceptan y se sirven ya traducidos |
| `clips/pokefus/guide.txt` (local) | la Guía del entrenador entera | se sustituye el archivo |
| Socket del juego | temperamentos, talentos, vínculo, chat | proxy TCP que traduce al vuelo |
| HTML de Electron | panel lateral, mapa, chat | se traduce la página en cada ventana |

## Por qué aguanta las actualizaciones

**Los archivos de idioma** no viajan dentro del cliente: se descargan en cada
arranque desde `pokefus.org`, guiados por un manifiesto. El servidor publica
cada archivo en francés **y** en español con la misma versión, y eso da un
detector de huecos exacto y gratis: si una cadena aparece idéntica en los dos,
es que nadie la tradujo. Cuando Pokefus publique `items_es_1181`, el extractor
lo compara con `items_fr_1181` y solo lo nuevo va al traductor; lo demás sale de
la memoria.

El cliente guarda esos archivos en el almacenamiento de Flash y solo los vuelve
a pedir cuando sube la versión. Por eso anunciamos una **versión sintética** (la
real más el número de revisión de la memoria): al subir la revisión, el cliente
tira su caché él solo.

**El texto del servidor** no está en ningún archivo: llega por TCP. El cliente
se conecta a un proxy local (se reescribe `config.xml` al arrancar) que traduce
cada mensaje y apunta lo que no sabe traducir en `tm/server-desconocidas.json`.
Si el proxy no arranca, `config.xml` vuelve al original y se conecta directo.

**La capa HTML** se traduce en el navegador, no reescribiendo los fuentes, y de
paso apunta en `tm/dom-desconocidas.json` todo lo que ve en francés y no sabe
traducir. Cuando Pokefus añada una pantalla nueva, aparece sola ahí.

## Estado

| Capa | Entradas |
|---|---|
| Archivos de idioma (`translations.json`) | 1 563 |
| Interfaz propia (`modules/core.swf`) | 737 |
| Pantalla de conexión (`loader.swf`) | 78 |
| Diccionario del proxy (`server.json`) | 3 013 |
| Nombres emparejados por id | 16 132 |
| Capa HTML (`dom.json`) | 32 |
| Guía del entrenador | 17 páginas |

Comprobado sobre 770 187 mensajes reales de partida: 0 separadores, 0 números y
0 campos de datos alterados. De los 23 750 archivos del cliente se modifican 6, y
`quitar traduccion` los devuelve byte a byte a como estaban.

Lo que queda en francés a propósito: los mensajes de arranque de `loader.swf` que
viven en bloques de bytecode ofuscado, y los rangos de arena a partir del segundo
(el código hace `rango + "e"`, y esa `"e"` es además el nombre de una variable del
bytecode: traducirla rompería el cliente).

## Lo que hubo que resolver

**La tabla de cadenas está llena.** Su longitud es un `uint16` y el generador de
Dofus la rellena al tope: 21 de los 198 pools miden 65535 B exactos, justo los de
`items` y `dialog`. Ahí se deja el pool intacto y se convierte la referencia en
un `ActionPush` con la cadena literal (`estrategia: 'inline'`). En `loader.swf`,
que es código y no datos, se hace al revés (`'pool'`).

**Los desplazamientos son relativos.** `Jump`, `If`, `With` y el `codeSize` de
las funciones apuntan por distancia en bytes. Cambiar el tamaño de una acción sin
rehacer esos números deja un SWF válido y un cliente que se queda cargando para
siempre. De eso se encarga `src/actions.js`.

## Archivos

    aplicar.js            el único comando
    src/swf.js            lectura de SWF
    src/actions.js        reconstruye bytecode recolocando saltos y funciones
    src/repack.js         reinyección (dos estrategias)
    src/resolve.js        cadenas que el bytecode empuja: sirve para verificar
    src/lang.js           manifiesto y descarga con caché
    src/classify.js       separa texto de juego de identificadores y datos
    src/extract.js        diff ES vs FR -> tm/pending.json
    src/extract-dom.js    texto francés de la capa HTML
    src/fusionar.js       mete las listas traducidas en la memoria
    src/server.js         sirve los archivos de idioma traducidos
    src/patch-local.js    parchea los SWF y textos locales
    src/proxy.js          proxy TCP que traduce lo que manda el servidor
    src/server-dic.js     arma el diccionario del proxy con todo lo ya traducido
    src/extract-local.js  lista lo que falta en los SWF locales
    src/verify.js         round-trip sobre todo lo que haya en cache/
    hook/                 enganche en el cliente y traductor del DOM
    tm/                   memoria de traducción
    backup/               originales intactos

### Comprobadores

Cada uno busca una clase distinta de error, y todos se pueden ejecutar sueltos:

    src/comprobar-cliente.js  los 23 750 archivos contra el manifiesto oficial
    src/comprobar.js          reproduce proxy.log: ¿se alteró algún número o separador?
    src/auditar-proxy.js      ídem, campo a campo: solo se puede tocar texto
    src/revisar-claves.js     claves francesas que ya no existen en el juego
    src/revisar-costuras.js   el texto YA PEGADO, que es donde se ven los fallos
    src/revisar-nombres.js    nombres que no coinciden con los del propio juego
    src/revisar-numeros.js    cifras que bailan entre el francés y el español
    src/revisar-estilo.js     restos de francés, puntuación, calcos
    src/pendientes-red.js     lo que el servidor mandó y no se supo traducir
    src/trozos-frances.js     qué trozo exacto falta, agrupando por forma
    src/riesgo.js             cadenas del SWF que son código y no texto

## Añadir traducciones

1. `node src/extract.js` — busca huecos nuevos (`tm/pending.json`).
2. Traducir en `tm/trad-<archivo>.json`, una lista en el mismo orden que
   `tm/por-traducir.json`. Los archivos grandes se parten: `trad-dialog-a.json`,
   `-b`, `-c`... Una entrada vacía deja esa cadena sin traducir.
3. `node src/fusionar.js` — sube la revisión, así que el cliente lo recoge solo.

Para los SWF locales: `node src/extract-local.js` lista lo que falta en
`loader.swf` y `modules/core.swf`; se traduce directamente en `tm/loader.json` y
`tm/core.json`, que son diccionarios origen -> traducción.

Para la capa HTML, editar `tm/dom.json` directamente.

Para el servidor: crea el archivo vacío `tm/debug-proxy`, juega un rato y luego
`node src/pendientes-red.js` (lo que quedó sin traducir) y
`node src/trozos-frances.js` (qué trozo exacto falta). Se traduce en
`tm/server-manual.json` y se rehace el diccionario con `node src/server-dic.js`.
Al terminar, borra `tm/debug-proxy` y `proxy.log`: el registro crece deprisa.

`trozos-frances.js` agrupa quitando los números, y eso es lo que lo hace útil: una
ficha de hechizo cambia de cifras y ya es otra cadena, pero el trozo que falta
(`de faiblesse`, `Fait reculer de`) es siempre el mismo. Una entrada nueva puede
arreglar miles de mensajes.

## El protocolo del servidor

Tres cosas que costaron encontrar y que conviene no olvidar:

**La dirección del servidor de juego viaja como nombre de host**, no como IP:
`AYKgame.pokefus.org:5555;77`. Buscar solo IPv4 no encontraba nada y el cliente
se iba directo, dejando al proxy sin ver el tráfico que importa. Además esa
dirección se anuncia **una sola vez**, así que los puertos de redirección se
reservan por adelantado: abrirlos al leer el mensaje llega tarde.

**El texto largo viaja codificado en porcentajes.** La descripción de un
temperamento llega como `%2B10%20%25%20de%20puissance...`, así que hay que
descodificar campo a campo, traducir y volver a codificar. Buscar el francés en
la cadena cruda no encontraba nada.

**Los separadores mandan.** El protocolo estructura con `|`, `,`, `;` y `.`. Una
traducción que meta uno de ellos en un campo en claro parte el mensaje, así que
ahí solo se aplican traducciones sin separadores; en los campos codificados no
hay problema, porque acaban como `%2C`.

Para ver el protocolo en crudo: crear el archivo `tm/debug-proxy` y arrancar el
juego; los mensajes del servidor quedan en `proxy.log`. Borrarlo lo apaga.

## El cliente carga el francés encima del español

Esta fue la causa de que medio juego siguiera en francés por mucho que se
tradujeran los archivos ES: el cliente descarga los `_es_` **y después los
`_fr_`**, que los pisan. El archivo español traía "Bandana Mokete" con su
descripción completa y en pantalla salía "Bandana Troué".

`src/server.js` sirve el contenido español también cuando el cliente pide el
francés. La versión es la misma en los dos idiomas, solo cambia la letra.

## Los nombres los da el propio juego

El servidor manda en francés el nombre de cada Dofemon, monstruo, objeto y
hechizo. La traducción ya existe en el archivo español, así que no hay que
escribirla: se emparejan los dos archivos **por id**.

Los datos son registros con la misma forma en los dos idiomas — un marcador de
tipo, el id, el campo y el valor:

    "M", #119, "n", "Forgeron Sombre", "g", #1074, ...
    "M", #119, "n", "Herrero Oscuro",  "g", #1074, ...

El id es idéntico en todos los idiomas. Se localiza el marcador dominante de
cada archivo (monstruos, objetos, hechizos, PNJ), se indexa id → nombre en cada
idioma y se cruzan: **14 552 nombres**, y es exacto — o el id está en los dos
lados o no hay pareja. `node src/pares.js` lo regenera tras cada actualización.

Antes se intentó alinear las dos secuencias token a token. Se descartó: en los
archivos grandes se desincronizan y salían parejas falsas como "Petit Bouftou"
contra "Thanos".

**Nombres y frases van por caminos distintos** en el proxy: los nombres a un
índice de consulta exacta, las frases a búsqueda por subcadena. Mezclarlos
costaba 2 ms por mensaje; separados, 0,006 ms.
