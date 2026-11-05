// Mídia: remove metadados ANTES de qualquer envio e cifra o arquivo no navegador.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------- Cifra do arquivo (chave aleatória por arquivo; a chave vai dentro da mensagem cifrada) ----------
export async function sealBytes(bytes) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { data, key: b64(await crypto.subtle.exportKey("raw", key)), iv: b64(iv) };
}
export async function openBytes(data, keyB64, ivB64) {
  const key = await crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, data));
}

// ---------- Imagem: redesenhar no canvas descarta EXIF, GPS, miniatura, perfil de câmera, etc. ----------
export async function cleanImage(file, maxSide = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } // aplica a rotação do EXIF antes de descartá-lo
  catch { throw new Error("Não consegui abrir essa imagem. Use JPG, PNG ou WebP."); }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"), png = file.type === "image/png";
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const mime = png ? "image/png" : "image/jpeg";
  const blob = await new Promise((r) => c.toBlob(r, mime, 0.86));
  if (!blob) throw new Error("Não foi possível preparar essa imagem.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, w, h };
}

// ---------- Vídeo MP4/MOV: limpa o contêiner sem recodificar (sem perder qualidade) ----------
// Mantém o mesmo tamanho de arquivo: o que é removido vira um bloco "free" zerado,
// então os deslocamentos internos (stco/co64) continuam válidos.
const BAD = "Não consegui limpar este vídeo. Envie um arquivo MP4 ou MOV comum.";
const KEEP_TOP = ["ftyp", "mdat", "moof", "styp", "sidx", "mfra"];
const MEDIA_HANDLERS = ["vide", "soun", "text", "subt", "sbtl", "clcp"];

export function cleanVideo(input) {
  const buf = new Uint8Array(input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);

  const list = (start, end) => {
    const out = []; let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o), hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) throw new Error(BAD);
      out.push({ o, size, hdr, t: tag(o + 4), end: o + size }); o += size;
    }
    return out;
  };
  const kids = (b) => list(b.o + b.hdr, b.end);
  const wipe = (b) => { buf.fill(0, b.o + b.hdr, b.end); buf.set([0x66, 0x72, 0x65, 0x65], b.o + 4); }; // vira "free"
  const zeroTimes = (b) => { // mvhd/tkhd/mdhd: data de criação e modificação
    const p = b.o + b.hdr, len = buf[p] === 1 ? 8 : 4;
    buf.fill(0, p + 4, p + 4 + 2 * len);
  };
  const child = (b, t) => kids(b).find((k) => k.t === t);
  function clearCodecName(minf) { // "compressorname" do vídeo (ex.: "Lavc60 libx264")
    const stbl = child(minf, "stbl"), stsd = stbl && child(stbl, "stsd");
    if (!stsd) return;
    let o = stsd.o + stsd.hdr + 8;
    const n = dv.getUint32(stsd.o + stsd.hdr + 4);
    for (let i = 0; i < n && o + 86 <= stsd.end; i++) {
      const size = dv.getUint32(o); if (size < 86) break;
      buf.fill(0, o + 50, o + 82); o += size;
    }
  }

  function zeroSamples(trak) { // apaga os bytes de amostras de uma faixa removida (ex.: GPS em faixa de metadados)
    const mdia = child(trak, "mdia"), minf = mdia && child(mdia, "minf"), stbl = minf && child(minf, "stbl");
    if (!stbl) return;
    const k = kids(stbl), stsz = k.find((x) => x.t === "stsz"), stsc = k.find((x) => x.t === "stsc"), stco = k.find((x) => x.t === "stco" || x.t === "co64");
    if (!stsz || !stsc || !stco) throw new Error(BAD);
    const sp = stsz.o + stsz.hdr, def = dv.getUint32(sp + 4), count = dv.getUint32(sp + 8);
    const size = (i) => (def || dv.getUint32(sp + 12 + 4 * i));
    const cp = stco.o + stco.hdr, nChunks = dv.getUint32(cp + 4);
    const off = (c) => (stco.t === "stco" ? dv.getUint32(cp + 8 + 4 * c) : Number(dv.getBigUint64(cp + 8 + 8 * c)));
    const sc = stsc.o + stsc.hdr, nEnt = dv.getUint32(sc + 4), ents = [];
    for (let i = 0; i < nEnt; i++) ents.push([dv.getUint32(sc + 8 + 12 * i), dv.getUint32(sc + 12 + 12 * i)]);
    let s = 0, e = 0;
    for (let c = 0; c < nChunks; c++) {
      while (e + 1 < ents.length && ents[e + 1][0] <= c + 1) e++;
      let o = off(c);
      for (let j = 0; j < ents[e][1] && s < count; j++, s++) {
        const n = size(s); if (o + n > buf.length) throw new Error(BAD);
        buf.fill(0, o, o + n); o += n;
      }
    }
  }

  const top = list(0, buf.length);
  if (!top.length || top[0].t !== "ftyp") throw new Error(BAD);
  const fragmented = top.some((b) => b.t === "moof");

  for (const b of top) {
    if (KEEP_TOP.includes(b.t)) continue;
    if (b.t !== "moov") { wipe(b); continue; } // udta, meta, uuid (XMP), free, skip...
    for (const m of kids(b)) {
      if (m.t === "mvhd") zeroTimes(m);
      else if (m.t === "mvex" || m.t === "iods") continue;
      else if (m.t === "trak") {
        const mdia = child(m, "mdia"), hdlr = mdia && child(mdia, "hdlr");
        if (!hdlr) throw new Error(BAD);
        const kind = tag(hdlr.o + hdlr.hdr + 8);
        if (!MEDIA_HANDLERS.includes(kind)) { // faixa de metadados/timecode: some, junto com os dados dela
          if (fragmented) throw new Error(BAD);
          zeroSamples(m); wipe(m); continue;
        }
        for (const t of kids(m)) {
          if (t.t === "tkhd") zeroTimes(t);
          else if (t.t === "edts" || t.t === "tref") continue;
          else if (t.t === "mdia") {
            for (const d of kids(t)) {
              if (d.t === "mdhd") zeroTimes(d);
              else if (d.t === "hdlr") buf.fill(0, d.o + d.hdr + 20, d.end); // nome do "handler" (às vezes traz nome do app/aparelho)
              else if (d.t === "minf") { if (kind === "vide") clearCodecName(d); }
              else wipe(d);
            }
          } else wipe(t); // udta, meta...
        }
      } else wipe(m); // udta (GPS, modelo do aparelho), meta (localização do iPhone)...
    }
  }
  return buf;
}

// ---------- Áudio: remove tags (ID3, LIST/INFO, ©xyz...) sem recodificar ----------
const BADA = "Não consegui limpar este áudio. Use um arquivo MP3, M4A ou WAV, ou grave pelo microfone.";
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// MP3: tira ID3v2 (início; pode haver mais de um), ID3v1 e APEv2 (fim). Os quadros de áudio ficam intactos.
function cleanMp3(b) {
  let s = 0, e = b.length;
  while (ascii(b, s, 3) === "ID3") {
    const size = ((b[s + 6] & 0x7f) << 21) | ((b[s + 7] & 0x7f) << 14) | ((b[s + 8] & 0x7f) << 7) | (b[s + 9] & 0x7f);
    s += 10 + size + (b[s + 5] & 0x10 ? 10 : 0);
    if (s >= e) throw new Error(BADA);
  }
  if (e - 128 >= s && ascii(b, e - 128, 3) === "TAG") e -= 128;
  if (e - 32 >= s && ascii(b, e - 32, 8) === "APETAGEX") { // tamanho do APE já inclui o rodapé; o cabeçalho (32 bytes) é opcional
    const tam = u32le(b, e - 32 + 12), flags = u32le(b, e - 32 + 20);
    e -= tam + (flags & 0x80000000 ? 32 : 0); if (e < s) throw new Error(BADA);
  }
  const limite = Math.min(e - 4, s + 4096); // pode haver algum preenchimento antes do 1º quadro
  while (s < limite && !(b[s] === 0xff && (b[s + 1] & 0xe0) === 0xe0)) s++;
  if (!(b[s] === 0xff && (b[s + 1] & 0xe0) === 0xe0) || e - s < 4) throw new Error(BADA);
  return b.slice(s, e);
}

// WAV: guarda só "fmt " e "data"; some tudo o mais (LIST/INFO com artista e software, bext, iXML, id3...).
function cleanWav(b) {
  const guardar = [];
  for (let o = 12; o + 8 <= b.length;) {
    const id = ascii(b, o, 4); let n = u32le(b, o + 4);
    if (o + 8 + n > b.length) n = b.length - o - 8; // "data" truncado: aproveita o que existe
    if (id === "fmt " || id === "data") guardar.push({ id, d: b.subarray(o + 8, o + 8 + n) });
    o += 8 + n + (n & 1);
  }
  if (!guardar.some((c) => c.id === "fmt ") || !guardar.some((c) => c.id === "data")) throw new Error(BADA);
  const total = 4 + guardar.reduce((s, c) => s + 8 + c.d.length + (c.d.length & 1), 0), out = new Uint8Array(8 + total), dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0); dv.setUint32(4, total, true); out.set(new TextEncoder().encode("WAVE"), 8);
  let o = 12;
  for (const c of guardar) { out.set(new TextEncoder().encode(c.id), o); dv.setUint32(o + 4, c.d.length, true); out.set(c.d, o + 8); o += 8 + c.d.length + (c.d.length & 1); }
  return out;
}

// WebM (só da gravação feita pelo próprio app): zera aplicativo gerador, título e data no bloco "Info" e
// transforma Tags, Attachments e Chapters em elementos "Void" (o formato prevê isso: o leitor os ignora).
// Tudo no mesmo lugar, sem mudar o tamanho do arquivo.
function scrubWebm(b) {
  const vint = (o, manterMarca) => { // número de tamanho variável (EBML)
    let len = 1; while (len <= 8 && !(b[o] & (0x80 >> (len - 1)))) len++;
    if (len > 8 || o + len > b.length) throw new Error(BADA);
    let v = manterMarca ? b[o] : b[o] & (0xff >> len);
    for (let i = 1; i < len; i++) v = v * 256 + b[o + i];
    const desconhecido = !manterMarca && [...b.subarray(o, o + len)].every((x, i) => (i === 0 ? (x & (0xff >> len)) === (0xff >> len) : x === 0xff));
    return { v, len, desconhecido };
  };
  const filho = (o, fim) => {
    const id = vint(o, true), tam = vint(o + id.len, false), ini = o + id.len + tam.len;
    return { id: id.v, o, ini, tam: tam.desconhecido ? fim - ini : tam.v, desconhecido: tam.desconhecido };
  };
  const ID = { EBML: 0x1a45dfa3, SEGMENT: 0x18538067, INFO: 0x1549a966, CLUSTER: 0x1f43b675,
    TAGS: 0x1254c367, ATTACHMENTS: 0x1941a469, CHAPTERS: 0x1043a770, MUXING: 0x4d80, WRITING: 0x5741, TITLE: 0x7ba9, DATE: 0x4461 };
  const VAZIAR = [ID.TAGS, ID.ATTACHMENTS, ID.CHAPTERS], ZERAR = [ID.MUXING, ID.WRITING, ID.TITLE, ID.DATE];
  const voidEm = (ini, fim) => { // preenche [ini, fim) com elementos Void (id 0xEC + tamanho de 1 byte)
    while (ini < fim) {
      let r = fim - ini, t = Math.min(r, 128); if (r - t === 1) t -= 1;
      b[ini] = 0xec; b[ini + 1] = 0x80 | (t - 2); b.fill(0, ini + 2, ini + t); ini += t;
    }
  };
  const cab = filho(0, b.length); if (cab.id !== ID.EBML) throw new Error(BADA);
  const seg = filho(cab.ini + cab.tam, b.length); if (seg.id !== ID.SEGMENT) throw new Error(BADA);
  let o = seg.ini, achouInfo = false, cauda = -1;
  while (o < b.length - 2) {
    const el = filho(o, b.length), fim = Math.min(b.length, el.ini + el.tam);
    if (VAZIAR.includes(el.id)) voidEm(el.o, fim);
    else if (el.id === ID.INFO) {
      achouInfo = true;
      for (let p = el.ini; p < fim;) { const c = filho(p, fim); if (ZERAR.includes(c.id)) b.fill(0, c.ini, Math.min(fim, c.ini + c.tam)); p = c.ini + c.tam; }
    } else if (el.id === ID.CLUSTER && el.desconhecido) { cauda = el.ini; break; } // gravação ao vivo: o fim do cluster não é conhecido
    o = fim;
  }
  if (!achouInfo) throw new Error(BADA);
  if (cauda >= 0) { // não dá para andar pelos clusters: se algum desses blocos aparecer mais adiante, não confiamos
    const aparece = (id) => { // procura os 4 bytes do id (sem Buffer: isto roda no navegador)
      const p = [id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255];
      for (let i = cauda; i <= b.length - 4; i++) if (b[i] === p[0] && b[i + 1] === p[1] && b[i + 2] === p[2] && b[i + 3] === p[3]) return true;
      return false;
    };
    if ([ID.TAGS, ID.ATTACHMENTS, ID.CHAPTERS].some(aparece)) throw new Error(BADA);
  }
  return b;
}

// Devolve { bytes, mime }. `gravado` = veio da gravação do próprio app (único caso em que aceitamos WebM).
export function cleanAudio(input, { gravado = false } = {}) {
  const b = new Uint8Array(input);
  if (b.length < 12) throw new Error(BADA);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return { bytes: cleanWav(b), mime: "audio/wav" };
  if (ascii(b, 4, 4) === "ftyp") return { bytes: cleanVideo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), mime: "audio/mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    if (!gravado) throw new Error("Formato não suportado. Use um arquivo MP3, M4A ou WAV, ou grave pelo microfone.");
    return { bytes: scrubWebm(b), mime: "audio/webm" };
  }
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { bytes: cleanMp3(b), mime: "audio/mpeg" };
  throw new Error("Formato não suportado. Use um arquivo MP3, M4A ou WAV, ou grave pelo microfone.");
}
