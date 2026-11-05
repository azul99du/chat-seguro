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
