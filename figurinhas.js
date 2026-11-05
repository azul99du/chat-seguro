// Figurinhas: biblioteca pessoal (só neste aparelho), criação com recorte por cliques e envio.
// Figurinha parada passa pelo canvas (descarta qualquer metadado) e sai como PNG com fundo transparente.
// Figurinha animada (GIF, WebP, APNG) é limpa sem recodificar. O envio em si é feito pelo app (cifrado como qualquer mídia).
import { listStickers, putSticker, delSticker } from "./store.js";
import { detectar, limparAnimada } from "./sticker.js";
import { criarRecorte, finalizar, alfaSuave, preencherBuracos } from "./cutout.js";

const MAX_BIBLIOTECA = 80, LADO = 512, TRABALHO = 1024, MAX_ARQUIVO = 20 * 1048576, MAX_ESTATICA = 500_000;
const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");
const idDe = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).slice(0, 32);
const blobPng = (c) => new Promise((r) => c.toBlob(r, "image/png"));

export function montarFigurinhas({ $, el, uid, note, choose, enviar }) {
  let lib = null, gerenciar = false, verMais = false, enviando = false;
  const urls = new Map(); // id -> blob URL
  const urlDe = (s) => { if (!urls.has(s.id)) urls.set(s.id, URL.createObjectURL(new Blob([s.bytes], { type: s.mime }))); return urls.get(s.id); };
  const carregar = async () => { if (!lib) lib = (await listStickers(uid)).sort((a, b) => b.t - a.t); return lib; };

  // ---------- Gaveta ----------
  function grade(box, itens, { apagavel = false } = {}) {
    box.replaceChildren(...itens.map((s) => {
      const cell = el("div", "stk-cell"), b = el("button", "stk-item"); b.type = "button";
      const img = new Image(); img.src = urlDe(s); img.alt = s.anim ? "Figurinha animada" : "Figurinha"; img.draggable = false; b.append(img);
      b.onclick = () => (gerenciar && apagavel ? apagar(s) : usar(s));
      cell.append(b);
      if (gerenciar && apagavel) { const x = el("span", "stk-x", "×"); x.setAttribute("aria-hidden", "true"); cell.append(x); b.setAttribute("aria-label", "Apagar esta figurinha"); }
      return cell;
    }));
  }
  function desenhar() {
    const recentes = lib.filter((s) => s.u > 0).sort((a, b) => b.u - a.u), vis = recentes.slice(0, verMais ? 24 : 8);
    $("stk-recent-sec").hidden = !recentes.length; grade($("stk-recent"), vis);
    $("stk-more").hidden = recentes.length <= 8; $("stk-more").textContent = verMais ? "Ver menos" : "Ver mais";
    grade($("stk-mine"), lib, { apagavel: true });
    $("stk-empty").hidden = lib.length > 0; $("stk-manage").hidden = !lib.length;
    $("stk-manage").textContent = gerenciar ? "Pronto" : "Gerenciar";
    $("stk-count").textContent = `${lib.length}/${MAX_BIBLIOTECA}`;
  }
  async function abrir() { await carregar(); gerenciar = false; desenhar(); if (!$("stk").open) $("stk").showModal(); }
  async function usar(s) {
    if (enviando) return; enviando = true;
    try { $("stk").close(); await enviar(s); s.u = Date.now(); putSticker(uid, s).catch(() => {}); }
    catch (e) { note(e?.message || "Não foi possível enviar a figurinha."); }
    finally { enviando = false; }
  }
  async function apagar(s) {
    const r = await choose("Apagar figurinha?", "Ela some só da sua lista, neste aparelho. Quem já recebeu continua com ela.", [{ label: "Apagar", value: "sim", cls: "primary" }, { label: "Manter", value: "nao", cls: "ghost" }]);
    if (r !== "sim") return;
    await delSticker(uid, s.id); lib = lib.filter((x) => x.id !== s.id); const u = urls.get(s.id); if (u) { URL.revokeObjectURL(u); urls.delete(s.id); }
    desenhar();
  }
  $("stk-close").onclick = () => $("stk").close();
  $("stk-more").onclick = () => { verMais = !verMais; desenhar(); };
  $("stk-manage").onclick = () => { gerenciar = !gerenciar; desenhar(); };

  // ---------- Guardar na biblioteca ----------
  // devolve "ok" | "repetida" | "cheia"
  async function guardar({ bytes, mime, w, h, anim }) {
    await carregar(); const id = await idDe(bytes);
    if (lib.some((s) => s.id === id)) return "repetida";
    if (lib.length >= MAX_BIBLIOTECA) return "cheia";
    const st = { id, mime, w, h, anim: !!anim, t: Date.now(), u: 0, bytes }; await putSticker(uid, st); lib.unshift(st); return "ok";
  }
  const avisoGuardar = (r) => r === "cheia" ? note(`Sua lista está cheia (${MAX_BIBLIOTECA} figurinhas). Apague alguma em Gerenciar para guardar outra.`) : r === "repetida" ? note("Você já tem essa figurinha.") : null;
  // figurinha que chegou numa conversa: só aceita se for imagem de verdade
  async function salvarRecebida(bytes) {
    const d = detectar(bytes); if (!d) return "invalida";
    if (d.animado) { const c = limparAnimada(bytes); return guardar(c); }
    return guardar({ bytes, mime: d.mime, w: d.w, h: d.h, anim: false });
  }

  // ---------- Criar ----------
  $("stk-new").onclick = () => $("stk-file").click();
  // vários arquivos de uma vez: animadas e figurinhas prontas (com fundo transparente) entram direto; fotos inteiras abrem o editor, uma de cada vez
  let fila = [], resumo = { novas: 0, repetidas: 0, falhas: 0, cheia: false };
  $("stk-file").onchange = async () => {
    const fs = [...$("stk-file").files]; $("stk-file").value = ""; if (!fs.length) return;
    fila = fs; resumo = { novas: 0, repetidas: 0, falhas: 0, cheia: false }; await proxima();
  };
  const conta = (r) => { if (r === "ok") resumo.novas++; else if (r === "repetida") resumo.repetidas++; else if (r === "cheia") resumo.cheia = true; else resumo.falhas++; };
  async function proxima() {
    while (fila.length) { const f = fila.shift(); if (await criar(f)) return; } // true = abriu o editor; a fila continua quando ele fechar
    await abrir();
    const m = [resumo.novas && `${resumo.novas} figurinha${resumo.novas > 1 ? "s" : ""} adicionada${resumo.novas > 1 ? "s" : ""}`, resumo.repetidas && `${resumo.repetidas} já existia${resumo.repetidas > 1 ? "m" : ""}`, resumo.falhas && `${resumo.falhas} não pôde ser lida${resumo.falhas > 1 ? "s" : ""}`, resumo.cheia && `lista cheia (${MAX_BIBLIOTECA}): apague alguma em Gerenciar`].filter(Boolean);
    if (resumo.falhas === 1 && !resumo.novas && !resumo.repetidas && !resumo.cheia && resumo.erro) note(resumo.erro);
    else if (resumo.falhas || resumo.cheia || resumo.repetidas) note(m.join(" · ") + ".");
  }
  async function criar(f) {
    try {
      if (f.size > MAX_ARQUIVO) throw new Error("Arquivo grande demais. O limite é de 20 MB.");
      const bytes = new Uint8Array(await f.arrayBuffer()), d = detectar(bytes);
      if (!d && !/^image\//.test(f.type)) throw new Error("Use uma imagem (PNG, JPG, WebP ou GIF).");
      if (d?.animado) { // animada: não dá para recortar quadro a quadro; limpa e guarda
        conta(await guardar(limparAnimada(bytes))); return false;
      }
      const bmp = await createImageBitmap(new Blob([bytes], { type: d?.mime || f.type }), { imageOrientation: "from-image" }).catch(() => { throw new Error("Não consegui abrir essa imagem."); });
      const k = Math.min(1, TRABALHO / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
      const dados = g.getImageData(0, 0, w, h); let claros = 0; for (let i = 3; i < dados.data.length; i += 4) if (dados.data[i] < 128) claros++;
      if (claros / (w * h) >= 0.02) { conta(await guardar(await exportar(dados, { ampliar: false }))); return false; } // já vem com fundo transparente: é uma figurinha pronta
      editar(dados); return true;
    } catch (e) { resumo.falhas++; resumo.erro = e?.message; return false; }
  }

  // ---------- Editor de recorte ----------
  let img, rc, modo = "manter", ver = false;
  const cv = () => $("stk-canvas");
  function pinta() {
    const { width: W, height: H, data } = img, out = new ImageData(W, H), a = ver ? alfaSuave($("stk-holes").checked ? preencherBuracos(rc.keep, img) : rc.keep, W, H) : null;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      out.data[p] = data[p]; out.data[p + 1] = data[p + 1]; out.data[p + 2] = data[p + 2];
      out.data[p + 3] = ver ? Math.round(a[i] * data[p + 3] / 255) : rc.keep[i] ? data[p + 3] : Math.round(data[p + 3] * 0.22);
    }
    cv().getContext("2d").putImageData(out, 0, 0);
    const n = rc.mantidos(), pct = Math.round((n / (W * H)) * 100);
    $("stk-status").textContent = n ? `${rc.passos()} toque${rc.passos() === 1 ? "" : "s"} · ${pct}% da imagem mantida` : "Nada mantido ainda: toque no que você quer guardar.";
    $("stk-save").disabled = !n; $("stk-undo").disabled = !rc.passos(); $("stk-reset").disabled = !rc.passos();
  }
  function editar(imagem) {
    img = imagem; rc = criarRecorte(img); modo = "manter"; ver = false; $("stk-preview").checked = false; marcaModo();
    cv().width = img.width; cv().height = img.height; pinta(); $("stk").close(); $("stkedit").showModal();
  }
  const MODOS = { manter: "stk-mode-add", apagar: "stk-mode-del", mais: "stk-mode-brush", menos: "stk-mode-erase" };
  const marcaModo = () => { for (const [m, id] of Object.entries(MODOS)) $(id).setAttribute("aria-pressed", String(modo === m)); $("stk-brush-box").hidden = !(modo === "mais" || modo === "menos"); cv().style.cursor = modo === "mais" || modo === "menos" ? "cell" : "crosshair"; };
  for (const [m, id] of Object.entries(MODOS)) $(id).onclick = () => { modo = m; marcaModo(); };
  $("stk-auto").onclick = () => { const n = rc.fundo(Number($("stk-tol").value)); ver = false; $("stk-preview").checked = false; pinta(); if (!n) $("stk-status").textContent = "Não achei fundo nas bordas. Use Manter/Pincel."; };
  const ponto = (e) => { const r = cv().getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * img.width, ((e.clientY - r.top) / r.height) * img.height, (Number($("stk-brush").value) / r.width) * img.width]; };
  let pintando = false;
  cv().addEventListener("pointerdown", (e) => {
    e.preventDefault(); const [x, y, raio] = ponto(e), tol = Number($("stk-tol").value);
    if (modo === "mais" || modo === "menos") { pintando = true; cv().setPointerCapture(e.pointerId); rc.pincel(x, y, raio, modo === "mais" ? 1 : 0); pinta(); return; }
    const n = modo === "manter" ? rc.manter(x, y, tol) : rc.apagar(x, y, tol); ver = false; $("stk-preview").checked = false; pinta();
    if (!n) $("stk-status").textContent = modo === "manter" ? "Essa parte já está mantida ou é transparente. Tente outra." : "Nada para apagar aí: toque numa parte mantida.";
  });
  cv().addEventListener("pointermove", (e) => { if (!pintando) return; const [x, y, raio] = ponto(e); rc.pincel(x, y, raio, modo === "mais" ? 1 : 0); pinta(); });
  const solta = () => { if (pintando) { pintando = false; rc.fimTraco(); ver = false; $("stk-preview").checked = false; pinta(); } };
  cv().addEventListener("pointerup", solta); cv().addEventListener("pointercancel", solta);
  $("stk-undo").onclick = () => { rc.desfazer(); pinta(); };
  $("stk-reset").onclick = () => { rc.recomecar(); pinta(); };
  $("stk-preview").onchange = () => { ver = $("stk-preview").checked; pinta(); };
  $("stk-holes").onchange = () => pinta();
  $("stkedit").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); rc.desfazer(); pinta(); } });
  $("stk-cancel").onclick = () => { $("stkedit").close(); proxima(); };
  async function exportar(dados, { ampliar = true } = {}) { // ImageData -> PNG de até 512 px; se ficar pesado, reduz
    const c = document.createElement("canvas"); c.width = dados.width; c.height = dados.height; c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(dados.data), dados.width, dados.height), 0, 0);
    for (const lado of [LADO, 384, 256]) {
      const k = Math.min(ampliar ? Infinity : 1, lado / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
      const o = document.createElement("canvas"); o.width = w; o.height = h; const g = o.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, w, h);
      const blob = await blobPng(o); if (!blob) throw new Error("Não foi possível preparar a figurinha.");
      const bytes = new Uint8Array(await blob.arrayBuffer()); if (bytes.length <= MAX_ESTATICA || lado === 256) return { bytes, mime: "image/png", w, h, anim: false };
    }
  }
  async function salvarEditado(dados, opc) {
    $("stk-save").disabled = true;
    try {
      conta(await guardar(await exportar(dados, opc))); $("stkedit").close(); await proxima();
    } catch (e) { $("stk-save").disabled = false; note(e?.message || "Não foi possível salvar a figurinha."); }
  }
  $("stk-save").onclick = () => { const o = finalizar(img, rc.keep, { buracos: $("stk-holes").checked }); if (o) salvarEditado(o); };
  $("stk-whole").onclick = () => salvarEditado(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), { ampliar: false });
  return { abrir, salvarRecebida, uid };
}
