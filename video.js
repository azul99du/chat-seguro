// Compressão de vídeo no próprio aparelho: MP4/MOV (H.264 ou HEVC) → MP4 H.264 em 720p, ~2 Mbps, mantendo o áudio AAC como está.
// Usa só os recursos do navegador (WebCodecs); NENHUMA biblioteca de terceiros: a leitura e a escrita do MP4 são feitas aqui (poucas caixas, só o necessário).
// O arquivo novo é montado do zero com as caixas mínimas, então não carrega nenhum metadado do original (local, aparelho, datas).
// Qualquer coisa que não seja claramente segura (formato estranho, navegador sem suporte, resultado que não fica menor) devolve null: o chamador envia o original.
export const LADO_CURTO = 720, BITRATE = 2_000_000, MAX_FPS = 30, ESCALA_TEMPO = 90000;
const MAX_ENTRADA_MOOV = 64 * 1048576;

// ---------- leitura (só caixas pequenas ficam na memória; as amostras são lidas do arquivo sob demanda) ----------
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const quatro = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function caixas(b, ini = 0, fim = b.length) {
  const out = []; let o = ini;
  while (o + 8 <= fim) {
    let tam = u32(b, o), cab = 8;
    if (tam === 1) { tam = u32(b, o + 8) * 4294967296 + u32(b, o + 12); cab = 16; } else if (tam === 0) tam = fim - o;
    if (tam < cab || o + tam > fim) throw new Error("mp4 inválido");
    out.push({ t: quatro(b, o + 4), o, ini: o + cab, fim: o + tam }); o += tam;
  }
  return out;
}
const filho = (b, c, t) => caixas(b, c.ini, c.fim).find((x) => x.t === t);
async function lerTopo(file) { // acha moov e mdat sem ler o arquivo todo
  const out = []; let o = 0;
  while (o + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(o, o + 16).arrayBuffer()); let tam = u32(h, 0), cab = 8;
    if (tam === 1) { tam = u32(h, 8) * 4294967296 + u32(h, 12); cab = 16; } else if (tam === 0) tam = file.size - o;
    if (tam < cab || o + tam > file.size) throw new Error("mp4 inválido");
    out.push({ t: quatro(h, 4), o, tam }); o += tam;
  }
  return out;
}
export async function lerMp4(file) {
  const topo = await lerTopo(file), moov = topo.find((x) => x.t === "moov");
  if (!moov || topo.some((x) => x.t === "moof") || moov.tam > MAX_ENTRADA_MOOV) return null; // fragmentado (ou enorme): não mexemos
  const b = new Uint8Array(await file.slice(moov.o, moov.o + moov.tam).arrayBuffer()), faixas = [];
  const raiz = caixas(b)[0], mvhdOrigem = filho(b, raiz, "mvhd"), escMov = mvhdOrigem ? u32(b, mvhdOrigem.ini + (b[mvhdOrigem.ini] === 1 ? 20 : 12)) : 1000;
  for (const trak of caixas(b, raiz.ini, raiz.fim).filter((x) => x.t === "trak")) {
    const mdia = filho(b, trak, "mdia"), tkhd = filho(b, trak, "tkhd"); if (!mdia || !tkhd) continue;
    const hdlr = filho(b, mdia, "hdlr"), mdhd = filho(b, mdia, "mdhd"), minf = filho(b, mdia, "minf"), stbl = minf && filho(b, minf, "stbl"); if (!hdlr || !mdhd || !stbl) continue;
    const tipo = quatro(b, hdlr.ini + 8); if (tipo !== "vide" && tipo !== "soun") continue;
    const v = b[mdhd.ini], escala = u32(b, mdhd.ini + (v === 1 ? 20 : 12));
    const S = (t) => filho(b, stbl, t), stsd = S("stsd"), stts = S("stts"), stsz = S("stsz"), stsc = S("stsc"), stco = S("stco") || S("co64"), stss = S("stss"), ctts = S("ctts");
    if (!stsd || !stts || !stsz || !stsc || !stco || !escala) continue;
    const entrada = caixas(b, stsd.ini + 8, stsd.fim)[0]; if (!entrada) continue;
    const n = u32(b, stsz.ini + 8), fixo = u32(b, stsz.ini + 4), tamanho = (i) => fixo || u32(b, stsz.ini + 12 + 4 * i);
    // chunks → deslocamento de cada amostra
    const nCh = u32(b, stco.ini + 4), off64 = stco.t === "co64", offChunk = (c) => (off64 ? u32(b, stco.ini + 8 + 8 * c) * 4294967296 + u32(b, stco.ini + 12 + 8 * c) : u32(b, stco.ini + 8 + 4 * c));
    const nSc = u32(b, stsc.ini + 4), sc = []; for (let i = 0; i < nSc; i++) sc.push([u32(b, stsc.ini + 8 + 12 * i), u32(b, stsc.ini + 12 + 12 * i)]);
    const amostras = new Array(n); let k = 0, e = 0;
    for (let c = 0; c < nCh && k < n; c++) {
      while (e + 1 < sc.length && sc[e + 1][0] <= c + 1) e++;
      let o = offChunk(c);
      for (let j = 0; j < sc[e][1] && k < n; j++, k++) { const t = tamanho(k); amostras[k] = { o, t, dts: 0, cts: 0, sync: true }; o += t; }
    }
    if (k !== n) throw new Error("mp4 inválido");
    // tempos
    let dts = 0, i = 0; const nStts = u32(b, stts.ini + 4);
    for (let r = 0; r < nStts; r++) { const cont = u32(b, stts.ini + 8 + 8 * r), delta = u32(b, stts.ini + 12 + 8 * r); for (let j = 0; j < cont && i < n; j++, i++) { amostras[i].dts = dts; amostras[i].cts = dts; dts += delta; } }
    if (ctts) { const v2 = b[ctts.ini], nC = u32(b, ctts.ini + 4); let q = 0; for (let r = 0; r < nC; r++) { const cont = u32(b, ctts.ini + 8 + 8 * r); let off = u32(b, ctts.ini + 12 + 8 * r); if (v2 === 1 && off > 0x7fffffff) off -= 4294967296; for (let j = 0; j < cont && q < n; j++, q++) amostras[q].cts += off; } }
    if (stss) { for (const a of amostras) a.sync = false; const nS = u32(b, stss.ini + 4); for (let r = 0; r < nS; r++) { const idx = u32(b, stss.ini + 8 + 4 * r) - 1; if (amostras[idx]) amostras[idx].sync = true; } }
    const dados = (x) => b.slice(x.o, x.fim); // cópia (a caixa inteira, com cabeçalho)
    let elst = null; // lista de edição simples (1 trecho): é ela que descarta os ~46 ms iniciais do AAC (atraso do codificador)
    { const edts = filho(b, trak, "edts"), el = edts && filho(b, edts, "elst");
      if (el && u32(b, el.ini + 4) === 1) { const v1 = b[el.ini] === 1, seg = v1 ? u32(b, el.ini + 12) : u32(b, el.ini + 8), mt = v1 ? u32(b, el.ini + 20) : u32(b, el.ini + 12), neg = (v1 ? b[el.ini + 16] : b[el.ini + 12]) & 0x80; if (!neg) elst = { segundos: seg / escMov, mediaTime: mt }; } }
    const f = { tipo, elst, id: u32(b, tkhd.ini + (b[tkhd.ini] === 1 ? 20 : 12)), escala, duracao: dts, entrada: b.slice(entrada.o, entrada.fim), codec: quatro(b, entrada.o + 4), amostras, sttsBruto: dados(stts) };
    if (tipo === "vide") {
      f.largura = u16(b, entrada.o + 8 + 24); f.altura = u16(b, entrada.o + 8 + 26);
      f.matriz = b.slice(tkhd.ini + (b[tkhd.ini] === 1 ? 52 : 40), tkhd.ini + (b[tkhd.ini] === 1 ? 88 : 76));
      for (const c of caixas(b, entrada.o + 8 + 78, entrada.fim)) if (c.t === "avcC" || c.t === "hvcC") f.config = { t: c.t, dados: b.slice(c.ini, c.fim) };
    }
    faixas.push(f);
  }
  const video = faixas.find((x) => x.tipo === "vide"), audio = faixas.find((x) => x.tipo === "soun");
  return video ? { video, audio, faixas } : null;
}

// ---------- janela de leitura: lê o arquivo em blocos grandes, não amostra por amostra ----------
function janela(file) {
  let ini = 0, fim = 0, buf = null;
  return async (o, t) => {
    if (!buf || o < ini || o + t > fim) { ini = o; fim = Math.min(file.size, o + Math.max(t, 4 * 1048576)); buf = new Uint8Array(await file.slice(ini, fim).arrayBuffer()); }
    return buf.subarray(o - ini, o - ini + t);
  };
}

// ---------- códigos de codec para o decodificador ----------
const hex = (n) => n.toString(16).padStart(2, "0");
export function codecDe(video) {
  const c = video.config; if (!c) return null; const d = c.dados;
  if (c.t === "avcC") return `avc1.${hex(d[1])}${hex(d[2])}${hex(d[3])}`;
  const espaco = ["", "A", "B", "C"][(d[1] >> 6) & 3], tier = (d[1] >> 5) & 1 ? "H" : "L", perfil = d[1] & 31;
  let compat = u32(d, 2), rev = 0; for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; } rev >>>= 0;
  const restr = [...d.slice(6, 12)]; while (restr.length > 1 && restr[restr.length - 1] === 0) restr.pop();
  return `${video.codec}.${espaco}${perfil}.${rev.toString(16)}.${tier}${d[12]}${restr.map((x) => "." + x.toString(16).toUpperCase()).join("")}`;
}
export const suportaCompressao = () => typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined" && typeof EncodedVideoChunk !== "undefined" && typeof OffscreenCanvas !== "undefined";

// ---------- escrita ----------
class Bytes {
  constructor() { this.p = []; this.n = 0; }
  u8(...v) { this.p.push(Uint8Array.from(v)); this.n += v.length; return this; }
  u16(v) { return this.u8(v >> 8, v & 255); }
  u32(v) { return this.u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  s(t) { return this.u8(...[...t].map((c) => c.charCodeAt(0))); }
  raw(a) { this.p.push(a); this.n += a.length; return this; }
  zeros(k) { return this.raw(new Uint8Array(k)); }
  fim() { const o = new Uint8Array(this.n); let i = 0; for (const a of this.p) { o.set(a, i); i += a.length; } return o; }
}
const caixa = (t, ...partes) => { const b = new Bytes(); for (const p of partes) b.raw(p instanceof Bytes ? p.fim() : p); const c = b.fim(); return new Bytes().u32(c.length + 8).s(t).raw(c).fim(); };
const completa = (t, versao, flags, ...partes) => caixa(t, new Bytes().u8(versao, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255).fim(), ...partes);
const ident = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];
function agrupa(valores) { const g = []; for (const v of valores) { const u = g[g.length - 1]; if (u && u[1] === v) u[0]++; else g.push([1, v]); } return g; }

// faixa = { tipo, escala, duracaoMov, amostras:[{t, dur, sync}], chunks:[{n, off}], stsd (bytes da caixa stsd inteira), largura, altura, matriz, sttsBruto? }
function montaTrak(f, id, duracaoMovMs) {
  const video = f.tipo === "vide", stszBytes = new Bytes().u32(0).u32(f.amostras.length); for (const a of f.amostras) stszBytes.u32(a.t);
  const sttsB = f.sttsBruto ?? (() => { const g = agrupa(f.amostras.map((a) => a.dur)), b = new Bytes().u32(g.length); for (const [n, d] of g) b.u32(n).u32(d); return completa("stts", 0, 0, b.fim()); })();
  const g = agrupa(f.chunks.map((c) => c.n)); let primeiro = 1; const sc = new Bytes().u32(g.length); for (const [rep, n] of g) { sc.u32(primeiro).u32(n).u32(1); primeiro += rep; }
  const co = new Bytes().u32(f.chunks.length); for (const c of f.chunks) co.u32(c.off);
  const stbl = [f.stsd, sttsB];
  if (video) { const chaves = []; f.amostras.forEach((a, i) => a.sync && chaves.push(i + 1)); const ss = new Bytes().u32(chaves.length); for (const c of chaves) ss.u32(c); stbl.push(completa("stss", 0, 0, ss.fim())); }
  stbl.push(completa("stsz", 0, 0, stszBytes.fim()), completa("stsc", 0, 0, sc.fim()), completa("stco", 0, 0, co.fim()));
  const tkhd = completa("tkhd", 0, 3, new Bytes().u32(0).u32(0).u32(id).u32(0).u32(duracaoMovMs).zeros(8).u16(0).u16(0).u16(video ? 0 : 0x0100).u16(0).raw(video ? f.matriz : Uint8Array.from(ident)).u32(video ? f.largura * 65536 : 0).u32(video ? f.altura * 65536 : 0).fim());
  const mdhd = completa("mdhd", 0, 0, new Bytes().u32(0).u32(0).u32(f.escala).u32(f.duracao).u16(0x55c4).u16(0).fim());
  const hdlr = completa("hdlr", 0, 0, new Bytes().u32(0).s(video ? "vide" : "soun").zeros(12).s(video ? "VideoHandler" : "SoundHandler").u8(0).fim());
  const midia = completa(video ? "vmhd" : "smhd", 0, video ? 1 : 0, new Bytes().zeros(video ? 8 : 4).fim());
  const dinf = caixa("dinf", completa("dref", 0, 0, new Bytes().u32(1).raw(completa("url ", 0, 1)).fim()));
  const edts = !video && f.elst ? [caixa("edts", completa("elst", 0, 0, new Bytes().u32(1).u32(Math.round(f.elst.segundos * 1000)).u32(f.elst.mediaTime).u16(1).u16(0).fim()))] : [];
  return caixa("trak", tkhd, ...edts, caixa("mdia", mdhd, hdlr, caixa("minf", midia, dinf, caixa("stbl", ...stbl))));
}
function montaMoov(faixas, duracaoMovMs) {
  const mvhd = completa("mvhd", 0, 0, new Bytes().u32(0).u32(0).u32(1000).u32(duracaoMovMs).u32(0x00010000).u16(0x0100).zeros(10).raw(Uint8Array.from(ident)).zeros(24).u32(faixas.length + 1).fim());
  return caixa("moov", mvhd, ...faixas.map((f, i) => montaTrak(f, i + 1, duracaoMovMs)));
}
const FTYP = caixa("ftyp", new Bytes().s("isom").u32(512).s("isom").s("iso2").s("avc1").s("mp41").fim());

// Monta o arquivo final: ftyp + moov (no começo, para tocar logo) + mdat com as amostras intercaladas a cada ~1 s.
// `amostrasVideo`: [{dados:Uint8Array, dur, sync, ptsSeg}]; áudio: amostras da origem lidas do arquivo (Blob.slice, sem copiar).
export function montaMp4({ largura, altura, matriz, avcC, amostrasVideo, audio, arquivoOrigem }) {
  const sttsV = amostrasVideo.map((a) => ({ t: a.dados.length, dur: a.dur, sync: a.sync }));
  const stsdV = completa("stsd", 0, 0, new Bytes().u32(1).raw((() => {
    const e = new Bytes().zeros(6).u16(1).zeros(16).u16(largura).u16(altura).u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff).raw(caixa("avcC", avcC)).fim();
    return caixa("avc1", e);
  })()).fim());
  const duracaoV = sttsV.reduce((s, a) => s + a.dur, 0), durMs = Math.round((duracaoV / ESCALA_TEMPO) * 1000);
  const faixaV = { tipo: "vide", escala: ESCALA_TEMPO, duracao: duracaoV, amostras: sttsV, stsd: stsdV, largura, altura, matriz, chunks: [] };
  let faixaA = null, amA = [];
  if (audio) {
    amA = audio.amostras; const dur = audio.duracao;
    faixaA = { tipo: "soun", escala: audio.escala, duracao: dur, amostras: amA.map((a) => ({ t: a.t })), stsd: completa("stsd", 0, 0, new Bytes().u32(1).raw(audio.entrada).fim()), sttsBruto: audio.sttsBruto, elst: audio.elst, chunks: [] };
  }
  // intercalação por janelas de 1 s
  const partes = [], ordem = []; // ordem: [{faixa, ini, n}]
  const janelaV = amostrasVideo.map((a) => Math.floor(a.ptsSeg)), janelaA = amA.map((a) => Math.floor(a.dts / audio.escala));
  let iv = 0, ia = 0;
  while (iv < amostrasVideo.length || ia < amA.length) {
    const w = Math.min(iv < amostrasVideo.length ? janelaV[iv] : Infinity, ia < amA.length ? janelaA[ia] : Infinity);
    let nv = 0; while (iv + nv < amostrasVideo.length && janelaV[iv + nv] <= w) nv++;
    let na = 0; while (ia + na < amA.length && janelaA[ia + na] <= w) na++;
    if (nv) { ordem.push({ f: faixaV, ini: iv, n: nv, v: true }); iv += nv; }
    if (na) { ordem.push({ f: faixaA, ini: ia, n: na, v: false }); ia += na; }
  }
  const monta = (base) => { // base = deslocamento do primeiro byte do mdat
    let off = base; faixaV.chunks = []; if (faixaA) faixaA.chunks = [];
    for (const c of ordem) {
      const tam = c.v ? amostrasVideo.slice(c.ini, c.ini + c.n).reduce((s, a) => s + a.dados.length, 0) : amA.slice(c.ini, c.ini + c.n).reduce((s, a) => s + a.t, 0);
      c.f.chunks.push({ n: c.n, off }); off += tam;
    }
    return { moov: montaMoov(faixaA ? [faixaV, faixaA] : [faixaV], durMs), total: off - base };
  };
  let m = monta(0); const cab = 8; // 1ª passada só mede o tamanho do moov (ele não depende dos valores dos deslocamentos)
  const base = FTYP.length + m.moov.length + cab; m = monta(base);
  const mdatCab = new Bytes().u32(m.total + 8).s("mdat").fim();
  partes.push(FTYP, m.moov, mdatCab);
  for (const c of ordem) {
    if (c.v) for (let i = c.ini; i < c.ini + c.n; i++) partes.push(amostrasVideo[i].dados);
    else for (let i = c.ini; i < c.ini + c.n; i++) partes.push(arquivoOrigem.slice(amA[i].o, amA[i].o + amA[i].t)); // áudio: copiado como está, direto do arquivo de origem
  }
  return partes;
}

// ---------- compressão ----------
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const comLimite = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("travou")), ms); })]).finally(() => clearTimeout(t)); };
const par = (n) => Math.max(2, Math.round(n / 2) * 2);
export async function comprimirVideo(file, { onProgresso = () => {}, cancelado = () => false, alvo = LADO_CURTO } = {}) {
  if (!suportaCompressao()) return null;
  let mp4; try { mp4 = await lerMp4(file); } catch { return null; }
  if (!mp4) return null;
  const { video, audio } = mp4, codec = codecDe(video);
  const prof = video.config.dados[video.config.t === "avcC" ? 1 : 1];
  if (video.config.t === "avcC" ? [110, 122, 244].includes(prof) : (prof & 31) !== 1) return null; // 10 bits / HDR: sem conversão de cor aqui, então não mexemos
  if (!codec || !video.largura || !video.altura || video.amostras.length < 2) return null;
  if (audio && audio.codec !== "mp4a") return null; // outro áudio (AC-3, ALAC…): não arriscamos deixar o vídeo mudo
  const seg = video.duracao / video.escala; if (!(seg > 0)) return null;
  const curto = Math.min(video.largura, video.altura), escala = Math.min(1, alvo / curto);
  if (curto <= alvo * 1.05 && (file.size * 8) / seg <= BITRATE * 1.5) return null; // já é leve: só limpar metadados como antes
  const W = par(video.largura * escala), H = par(video.altura * escala);
  const cfgDec = { codec, codedWidth: video.largura, codedHeight: video.altura, description: video.config.dados };
  if (!(await VideoDecoder.isConfigSupported(cfgDec).catch(() => ({}))).supported) return null;
  const fps = Math.min(MAX_FPS, Math.max(1, Math.round(video.amostras.length / seg)));
  const cfgEnc = { codec: "avc1.640028", width: W, height: H, bitrate: BITRATE, framerate: fps, latencyMode: "quality", avc: { format: "avc" } };
  if (!(await VideoEncoder.isConfigSupported(cfgEnc).catch(() => ({}))).supported) return null;

  const saida = []; let avcC = null, erro = null, ultimoOut = Date.now(), decodificados = 0, ultimoPts = -Infinity, ptsAnterior = -1, entregues = 0;
  const enc = new VideoEncoder({
    output: (chunk, meta) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); if (meta?.decoderConfig?.description && !avcC) avcC = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength)); if (chunk.timestamp <= ptsAnterior) erro ||= new Error("ordem"); ptsAnterior = chunk.timestamp; saida.push({ dados: d, pts: chunk.timestamp, sync: chunk.type === "key" }); ultimoOut = Date.now(); },
    error: (e) => { erro ||= e; },
  });
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d", { alpha: false });
  const minDelta = (1e6 / MAX_FPS) * 0.8;
  const dec = new VideoDecoder({
    output: (frame) => {
      try {
        if (frame.timestamp - ultimoPts < minDelta) return; // acima de 30 fps: descarta quadros para chegar a ~30
        ultimoPts = frame.timestamp; ctx.drawImage(frame, 0, 0, W, H);
        const novo = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
        enc.encode(novo, { keyFrame: entregues % (fps * 2) === 0 }); entregues++; novo.close();
      } catch (e) { erro ||= e; } finally { frame.close(); decodificados++; ultimoOut = Date.now(); }
    },
    error: (e) => { erro ||= e; },
  });
  const parar = () => { try { dec.close(); } catch {} try { enc.close(); } catch {} };
  try {
    dec.configure(cfgDec); enc.configure(cfgEnc);
    const ler = janela(file), total = video.amostras.length;
    // ordem de decodificação = ordem de dts (como estão gravadas)
    const esperar = async (cond) => { while (!cond()) { if (erro) throw erro; if (cancelado()) throw Object.assign(new Error("cancelado"), { cancelado: true }); if (Date.now() - ultimoOut > 25000) throw new Error("travou"); await dorme(8); } };
    let minCts = Infinity; for (const a of video.amostras) if (a.cts < minCts) minCts = a.cts;
    for (let i = 0; i < total; i++) {
      await esperar(() => dec.decodeQueueSize < 6 && enc.encodeQueueSize < 6 && i - decodificados < 24);
      const a = video.amostras[i], dados = await ler(a.o, a.t);
      dec.decode(new EncodedVideoChunk({ type: a.sync ? "key" : "delta", timestamp: Math.round(((a.cts - minCts) / video.escala) * 1e6), data: dados }));
      if (i % 8 === 0) onProgresso(Math.min(0.97, i / total));
    }
    await comLimite(dec.flush(), 30000); await comLimite(enc.flush(), 30000);
    if (erro) throw erro;
  } catch (e) { parar(); if (e?.cancelado) throw e; return null; }
  parar();
  if (!avcC || saida.length < 2) return null;
  // durações (em 1/90000 s) = diferença até o próximo quadro; o último repete a anterior
  const am = saida.map((s, i) => ({ dados: s.dados, sync: s.sync, ptsSeg: s.pts / 1e6, dur: 0 }));
  for (let i = 0; i < am.length; i++) { const prox = i + 1 < saida.length ? saida[i + 1].pts : null; am[i].dur = Math.max(1, Math.round((prox !== null ? (prox - saida[i].pts) : (saida[i].pts - saida[i - 1].pts)) * ESCALA_TEMPO / 1e6)); }
  let partes;
  try { partes = montaMp4({ largura: W, altura: H, matriz: video.matriz, avcC, amostrasVideo: am, audio, arquivoOrigem: file }); } catch { return null; }
  const blob = new Blob(partes, { type: "video/mp4" });
  if (blob.size >= file.size * 0.9) return null; // não ficou claramente menor: melhor enviar o original
  onProgresso(1);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), largura: W, altura: H, duracao: seg };
}
