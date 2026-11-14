// Figurinhas: biblioteca pessoal (só neste aparelho), criação com recorte por cliques e envio.
// Figurinha parada passa pelo canvas (descarta qualquer metadado) e sai como PNG com fundo transparente.
// Figurinha animada (GIF, WebP, APNG) é limpa sem recodificar. O envio em si é feito pelo app (cifrado como qualquer mídia).
import { listStickers, putSticker, delSticker } from "./store.js?v=36efa5ccf7";
import { detectar, limparAnimada } from "./sticker.js?v=36efa5ccf7";
import { carregarSAM, definirImagem, segmentar } from "./sam2.js?v=36efa5ccf7";
import { escolherMascara, ampliarLogits, rampa, montarFigurinha } from "./recorte.js?v=36efa5ccf7";
import * as CFG from "./recorte-config.js?v=36efa5ccf7";
const { TAMANHO, KB_MAXIMO, LADO_PROCESSO, LARGURA_TELA } = CFG;

const MAX_BIBLIOTECA = 80, LADO = 512, TRABALHO = LADO_PROCESSO, MAX_ARQUIVO = 20 * 1048576, MAX_ESTATICA = 500_000;
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
      if (claros / (w * h) >= 0.02) { conta(await guardar(await exportar(dados))); return false; } // já vem com fundo transparente: é uma figurinha pronta
      editar(dados, c); return true;
    } catch (e) { resumo.falhas++; resumo.erro = e?.message; return false; }
  }

  // ---------- Editor de recorte (SAM 2.1: toque no que quer recortar) ----------
  // Fluxo do notebook recortador_figurinhas_sam2: pontos verdes sobre o objeto, o recorte aparece ao lado; tocar num ponto o remove.
  let foto = null, pontos = [], pedido = 0, resultado = null, analise = null, interno = false, ultAlfa = null, remover = false;
  const cfgAtual = () => ({ ...CFG, CONTORNO_PX: $("stk-contorno").checked ? CFG.CONTORNO_PX || 14 : 0 }); // contorno branco ligado/desligado pela pessoa
  function mostrar(fig) { const out = $("stk-out"); out.width = fig.width; out.height = fig.height; out.getContext("2d").putImageData(new ImageData(fig.data, fig.width, fig.height), 0, 0); resultado = fig; msg(""); $("stk-save").disabled = false; }
  const cv = () => $("stk-canvas");
  const msg = (t) => { $("stk-msg").textContent = t || ""; $("stk-msg").hidden = !t; $("stk-out").hidden = !!t; };
  function desenharFoto() {
    const c = cv(), g = c.getContext("2d"); g.drawImage(foto.canvas, 0, 0, c.width, c.height);
    const r = Math.max(10, c.width / 40);
    pontos.forEach(([px, py, tipo], n) => {
      const x = px * c.width, y = py * c.height; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = tipo === 0 ? "rgba(214,40,57,.95)" : "rgba(0,200,0,.9)"; g.fill();
      g.lineWidth = Math.max(2, r / 3); g.strokeStyle = "#fff"; g.stroke(); g.fillStyle = "#fff"; g.font = `bold ${Math.round(r * 1.2)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n + 1), x, y);
    });
    const verm = pontos.filter((p) => p[2] === 0).length;
    $("stk-info").textContent = pontos.length + (pontos.length === 1 ? " ponto" : " pontos") + (verm ? ` (${pontos.length - verm} verde${pontos.length - verm === 1 ? "" : "s"}, ${verm} vermelho${verm === 1 ? "" : "s"})` : "");
    $("stk-clear").disabled = !pontos.length;
  }
  function editar(imagem, canvas) {
    foto = { rgba: imagem.data, w: imagem.width, h: imagem.height, canvas }; pontos = []; resultado = null; ultAlfa = null; pedido++; remover = false; marcaModo(); $("stk-contorno").checked = (CFG.CONTORNO_PX || 0) > 0;
    cv().width = foto.w; cv().height = foto.h; cv().style.maxWidth = LARGURA_TELA + "px"; $("stk-save").disabled = true; $("stk-skip").disabled = false;
    msg("Toque no que quer recortar. Pode tocar em vários pontos.");
    $("stk-status").textContent = "Analisando a foto (só na 1ª vez baixa uns 62 MB)…";
    const meu = (analise = definirImagem(canvas).then(() => true).catch((e) => { console.warn("SAM 2.1:", e); return false; }));
    meu.then((ok) => { if (analise === meu) $("stk-status").textContent = ok ? "Pronto: toque no objeto." : "Não consegui carregar o recorte inteligente neste aparelho."; });
    desenharFoto(); interno = true; $("stk").close(); $("stkedit").showModal(); interno = false;
  }
  function marcaModo() { $("stk-modo").dataset.modo = remover ? "vermelho" : "verde"; $("stk-modo-txt").textContent = remover ? "Ponto vermelho: remover" : "Ponto verde: manter"; cv().style.cursor = remover ? "not-allowed" : "crosshair"; }
  $("stk-modo").onclick = () => { remover = !remover; marcaModo(); };
  async function recortar() {
    const meu = ++pedido; resultado = null; ultAlfa = null; $("stk-save").disabled = true;
    if (!pontos.length) return msg("O recorte aparece aqui.");
    if (!pontos.some((p) => p[2] !== 0)) return msg("Toque primeiro no que quer manter (ponto verde). O ponto vermelho só tira partes de um recorte.");
    msg("Recortando…"); await new Promise((r) => setTimeout(r, 30)); // deixa a tela pintar antes do cálculo
    try {
      if (!(await analise)) throw new Error("ia");
      const o = await segmentar(pontos.map((p) => [...p]), () => meu === pedido); if (meu !== pedido || !o) return;
      const alfa = rampa(ampliarLogits(escolherMascara(o.notas, o.logits, 256, undefined, pontos), 256, foto.w, foto.h)), fig = montarFigurinha(foto.rgba, foto.w, foto.h, alfa, cfgAtual());
      if (meu !== pedido) return;
      if (!fig) return msg("Não achei nada nesses pontos. Tente tocar em outro lugar.");
      ultAlfa = alfa; mostrar(fig);
    } catch (e) { console.warn("SAM 2.1:", e); if (meu === pedido) msg("Não consegui recortar. Toque de novo ou use outra foto."); }
  }
  cv().addEventListener("click", (e) => {
    if (!foto) return; const r = cv().getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const i = pontos.findIndex(([x, y]) => Math.hypot((x - px) * r.width, (y - py) * r.height) <= 14); // tocar num ponto o remove
    if (i >= 0) pontos.splice(i, 1); else pontos.push([px, py, remover ? 0 : 1]);
    desenharFoto(); recortar();
  });
  $("stk-contorno").onchange = () => { if (ultAlfa && resultado) { const fig = montarFigurinha(foto.rgba, foto.w, foto.h, ultAlfa, cfgAtual()); if (fig) mostrar(fig); } }; // refaz só o acabamento: não chama a IA de novo
  $("stk-clear").onclick = () => { pontos = []; desenharFoto(); recortar(); };
  $("stk-skip").onclick = () => { fechar(); proxima(); };
  $("stkedit").addEventListener("close", () => { if (!interno) { fila = []; abrir(); } }); // Esc/fechar: volta para a gaveta
  function fechar() { interno = true; $("stkedit").close(); interno = false; }
  const paraBlob = (c, tipo, q) => new Promise((r) => c.toBlob(r, tipo, q));
  async function codificar(fig) { // WebP até KB_MAXIMO (limite do WhatsApp); se o navegador não gera WebP (Safari), PNG
    const c = document.createElement("canvas"); c.width = fig.width; c.height = fig.height; c.getContext("2d").putImageData(new ImageData(fig.data, fig.width, fig.height), 0, 0);
    let blob = null;
    for (let q = 0.95; q > 0.2; q -= 0.05) { blob = await paraBlob(c, "image/webp", q); if (!blob || blob.type !== "image/webp" || blob.size <= KB_MAXIMO * 1024) break; }
    if (!blob || blob.type !== "image/webp") blob = await paraBlob(c, "image/png");
    if (!blob) throw new Error("Não foi possível preparar a figurinha.");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, w: fig.width, h: fig.height, anim: false };
  }
  async function exportar(dados) { // figurinha pronta (já transparente): PNG, no tamanho original (até TAMANHO)
    const c = document.createElement("canvas"); c.width = dados.width; c.height = dados.height; c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(dados.data), dados.width, dados.height), 0, 0);
    for (const lado of [TAMANHO, 384, 256]) {
      const k = Math.min(1, lado / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
      const o = document.createElement("canvas"); o.width = w; o.height = h; const g = o.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, w, h);
      const blob = await blobPng(o); if (!blob) throw new Error("Não foi possível preparar a figurinha.");
      const bytes = new Uint8Array(await blob.arrayBuffer()); if (bytes.length <= MAX_ESTATICA || lado === 256) return { bytes, mime: "image/png", w, h, anim: false };
    }
  }
  $("stk-save").onclick = async () => {
    if (!resultado) return; $("stk-save").disabled = true;
    try { conta(await guardar(await codificar(resultado))); fechar(); await proxima(); }
    catch (e) { $("stk-save").disabled = false; note(e?.message || "Não foi possível salvar a figurinha."); }
  };
  return { abrir, salvarRecebida, uid };
}
