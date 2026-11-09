// Traduz o texto do navegador (User-Agent) em algo legível. Não guardamos o texto original, só estes rótulos.
export function descreverAparelho(ua = "") {
  const t = String(ua).slice(0, 400);
  const sistema = /Android/i.test(t) ? "Android" : /iPhone|iPad|iPod/i.test(t) ? "iOS" : /Windows/i.test(t) ? "Windows" : /CrOS/i.test(t) ? "ChromeOS" : /Macintosh|Mac OS X/i.test(t) ? "macOS" : /Linux|X11/i.test(t) ? "Linux" : "Sistema desconhecido";
  const navegador = /SamsungBrowser/i.test(t) ? "Samsung Internet" : /Edg(e|A|iOS)?\//i.test(t) ? "Edge" : /OPR\/|Opera/i.test(t) ? "Opera" : /Firefox|FxiOS/i.test(t) ? "Firefox" : /Chrome|CriOS|HeadlessChrome/i.test(t) ? "Chrome" : /Safari/i.test(t) ? "Safari" : "Navegador desconhecido";
  const tipo = /iPad|Tablet/i.test(t) || (/Android/i.test(t) && !/Mobile/i.test(t)) ? "tablet" : /Mobile|iPhone|iPod|Android/i.test(t) ? "celular" : /Windows|Macintosh|Linux|X11|CrOS/i.test(t) ? "computador" : "outro";
  return { navegador, sistema, tipo };
}
