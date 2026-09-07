'use strict';

/*
 * Saca el texto frances de la capa HTML del cliente.
 *
 * El juego no es solo Flash: el launcher de Electron dibuja en HTML el panel
 * lateral, el mapa y la ventana de chat, y ese texto esta escrito en frances
 * dentro del propio codigo. No pasa por ningun archivo de idioma, asi que la
 * unica forma de encontrarlo es leer los fuentes -- que Pokefus distribuye sin
 * minificar.
 *
 * Se buscan solo los sitios donde una cadena acaba a la vista: el texto entre
 * etiquetas, los atributos que se muestran, y las asignaciones a textContent y
 * companeras. Barrer todos los literales traeria nombres de clase, rutas y
 * claves, que traducidos romperian la pagina.
 */

const fs = require('fs');
const path = require('path');

const RETROCLIENT = require('./instalacion').retroclient();

const HTML = ['D1ElectronLauncher.html', 'D1Chat.html', 'D1Console.html'];
const JS = ['js/pokefus-panel.js', 'js/pokefus-gamemap.js', 'js/D1Chat.js', 'js/D1Console.js'];

/* Marcas del frances que el espanol no comparte, mas las palabras sueltas de
 * interfaz que no llevan acento y aun asi hay que traducir. */
const ACENTOS = /[àâçèêëîïôùûœ]|é/;
const PALABRAS = /\b(vous|votre|nous|des|une|est|dans|pour|avec|sur|par|plus|tout|toute|mais|donc|pas|cette|aux|qui|que|jeu|joueur|joueurs|attente|choisir|cliquez|aucun|aucune|voir|afficher|masquer|copier|ouvrir|fermer|charger|envoyer|rechercher|revenir|classes|vente|ateliers|divers|donjons|dresseurs|recentrer|niveau|monde|carte|zone|serveur|combat|guilde|groupe|canal|message|prix|metier|nom|retour|suivant|annuler|valider)\b/i;
const SOLO_SIMBOLOS = /^[\s\d.,;:!?()[\]{}/\\|#*+_=<>%$@^~`'"-]*$/;

const esFrances = (texto) =>
  /[A-Za-zÀ-ÿ]{2}/.test(texto) && !SOLO_SIMBOLOS.test(texto) && (ACENTOS.test(texto) || PALABRAS.test(texto));

function deHtml(fuente, encontradas) {
  for (const m of fuente.matchAll(/>([^<>{}]{2,90})</g)) {
    const texto = m[1].trim();
    if (texto && esFrances(texto)) encontradas.add(texto);
  }

  for (const m of fuente.matchAll(/(?:title|placeholder|alt|aria-label)="([^"]{2,90})"/g)) {
    const texto = m[1].trim();
    if (texto && esFrances(texto)) encontradas.add(texto);
  }
}

/*
 * En el JS solo cuentan las asignaciones a propiedades que acaban en pantalla.
 * Los comentarios se quitan antes: los de este cliente estan en frances y
 * llenarian la lista de frases que nadie ve.
 */
function deJs(fuente, encontradas) {
  const limpio = fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  const propiedades = /(?:textContent|innerText|innerHTML|title|placeholder|alt|ariaLabel|label)\s*=\s*(['"])((?:(?!\1)[^\\])*)\1/g;
  for (const m of limpio.matchAll(propiedades)) {
    const texto = m[2].trim();
    if (texto && esFrances(texto)) encontradas.add(texto);
  }

  /* Etiquetas pasadas como argumento: crearPestana('Les dresseurs a defier', ...) */
  const argumentos = /\(\s*(['"])((?:(?!\1)[^\\]){2,70})\1\s*,/g;
  for (const m of limpio.matchAll(argumentos)) {
    const texto = m[2].trim();
    if (texto && esFrances(texto) && texto.includes(' ')) encontradas.add(texto);
  }
}

function main() {
  const encontradas = new Set();

  for (const archivo of HTML) {
    const ruta = path.join(RETROCLIENT, archivo);
    if (fs.existsSync(ruta)) deHtml(fs.readFileSync(ruta, 'utf8'), encontradas);
  }

  for (const archivo of JS) {
    const ruta = path.join(RETROCLIENT, archivo);
    if (fs.existsSync(ruta)) deJs(fs.readFileSync(ruta, 'utf8'), encontradas);
  }

  const lista = [...encontradas].sort();
  fs.writeFileSync(path.join(__dirname, '..', 'tm', 'dom-fr.json'), JSON.stringify(lista, null, 1));

  console.log(lista.length + ' cadenas -> tm/dom-fr.json');
  lista.forEach((t) => console.log('  ' + JSON.stringify(t)));
}

main();
