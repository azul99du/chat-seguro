// Motor de som das playlists: toca uma música de cada vez, seja um trecho da Apple (um <audio>) ou um vídeo do YouTube (um iframe controlado por postMessage,
// sem carregar nenhum script de fora: a política de segurança só libera a moldura do youtube-nocookie.com).
// Quem usa só diz "toque esta música a partir de tal segundo" e ouve de volta: acabou, deu erro, o navegador bloqueou o som (precisa de um toque).
export const YT_ORIGEM = "https://www.youtube-nocookie.com";
const SILENCIO = (() => { const n = 441, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), t = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); t(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); t(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, "data"); v.setUint32(40, n * 2, true); return b; })();
// Ponte com o iframe do YouTube. cb: { pronto(), info(info), erro(codigo) }
function ponteYoutube(frame, cb) {
  let vivo = true, timer = null, aberta = false;
  const manda = (o) => { try { frame.contentWindow?.postMessage(JSON.stringify(o), YT_ORIGEM); } catch {} };
  const escuta = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== YT_ORIGEM) return; let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; } if (!d || typeof d !== "object") return;
    if (d.event === "onReady" || d.event === "initialDelivery" || d.event === "infoDelivery") { if (!aberta) { aberta = true; clearInterval(timer); cb.pronto?.(); } }
    if ((d.event === "infoDelivery" || d.event === "initialDelivery") && d.info && typeof d.info === "object") cb.info?.(d.info); // (os dados do vídeo — título, duração — chegam primeiro em "initialDelivery")
    if (d.event === "onError") cb.erro?.(Number(d.info));
  };
  addEventListener("message", escuta);
  const aoCarregar = () => { let n = 0; clearInterval(timer); timer = setInterval(() => { manda({ event: "listening", id: 1, channel: "widget" }); if (aberta || ++n > 80) clearInterval(timer); }, 250); };
  frame.addEventListener("load", aoCarregar);
  return { manda, fechar() { vivo = false; clearInterval(timer); removeEventListener("message", escuta); frame.removeEventListener("load", aoCarregar); }, get aberta() { return aberta; } };
}
const urlEmbed = (id, pos, tocando) => `${YT_ORIGEM}/embed/${id}?enablejsapi=1&playsinline=1&controls=0&rel=0&modestbranding=1&fs=0&iv_load_policy=3&disablekb=1&autoplay=${tocando ? 1 : 0}&start=${Math.max(0, Math.floor(pos || 0))}&origin=${encodeURIComponent(location.origin)}`;
const novoFrame = (id, pos, tocando, classe) => { const f = document.createElement("iframe"); f.className = classe; f.title = "Vídeo do YouTube (música da playlist)"; f.allow = "autoplay; encrypted-media"; f.referrerPolicy = "strict-origin-when-cross-origin"; f.setAttribute("sandbox", "allow-scripts allow-same-origin"); f.src = urlEmbed(id, pos, tocando); return f; };
// Descobre o título e a duração de um vídeo do YouTube (e se ele deixa tocar fora do YouTube) abrindo um player escondido por alguns segundos
export function sondarYoutube(id, { espera = 15000 } = {}) {
  return new Promise((ok, falha) => {
    const f = novoFrame(id, 0, false, "pl-sonda"); f.tabIndex = -1; f.setAttribute("aria-hidden", "true"); let fim = false, ponte = null, t = null;
    const acaba = (fn, v) => { if (fim) return; fim = true; clearTimeout(t); ponte?.fechar(); f.remove(); fn(v); };
    const juntos = {}; // (o YouTube manda os dados aos poucos: título numa mensagem, duração em outra)
    ponte = ponteYoutube(f, { info: (i) => { Object.assign(juntos, i); const vd = juntos.videoData; if (vd && typeof vd.title === "string" && vd.title && Number(juntos.duration) > 0) acaba(ok, { titulo: vd.title.slice(0, 100), autor: String(vd.author || "").slice(0, 80), duracao: Math.round(Number(juntos.duration)) }); }, erro: (c) => acaba(falha, Object.assign(new Error("erro"), { codigo: c })) });
    t = setTimeout(() => acaba(falha, Object.assign(new Error("tempo"), { codigo: 0 })), espera); document.body.append(f);
  });
}
// criarMotor({ palco, aoFim, aoErro, aoBloquear, aoInfo }): palco = elemento onde o iframe do YouTube mora (visível quando a música é de vídeo)
export function criarMotor({ palco, aoFim = () => {}, aoErro = () => {}, aoBloquear = () => {}, aoInfo = () => {}, log = () => {} }) {
  let audio = null, yt = null, ponte = null, faixa = null, mudo = false, destravado = false, geracao = 0, ytGer = 0, quer = false, ytInfo = { t: 0, em: 0, dur: 0, estado: -1 }, ytPronto = null, ytTocando = false;
  const maca = () => { if (!audio) { audio = new Audio(); audio.preload = "auto"; audio.onended = () => { if (faixa?.t === "a") aoFim(); }; audio.onerror = () => { if (faixa?.t === "a") aoErro(0); }; } return audio; };
  const fechaYt = () => { ytGer++; ponte?.fechar(); ponte = null; yt?.remove(); yt = null; ytPronto = null; ytInfo = { t: 0, em: 0, dur: 0, estado: -1 }; palco.hidden = true; };
  const abreYt = (id, pos, tocando) => {
    fechaYt(); const g = ytGer; yt = novoFrame(id, pos, tocando, "pl-yt"); ytTocando = tocando; // (g marca ESTE iframe: as respostas dele só valem enquanto ele for o atual; trocar de música dentro do mesmo iframe não as invalida)
    ytPronto = new Promise((ok) => { ponte = ponteYoutube(yt, { pronto: () => { log("yt-pronto"); ok(); }, erro: (c) => { if (g === ytGer) aoErro(c); },
      info: (i) => { if (g !== ytGer) return; if (Number.isFinite(i.currentTime)) { ytInfo.t = i.currentTime; ytInfo.em = performance.now(); } if (Number.isFinite(i.duration) && i.duration > 0 && i.duration !== ytInfo.dur) { ytInfo.dur = i.duration; aoInfo({ duracao: Math.round(i.duration) }); }
        if (Number.isFinite(i.playerState) && i.playerState !== ytInfo.estado) { const antes = ytInfo.estado; ytInfo.estado = i.playerState; log("yt-estado", antes, ">", i.playerState); if (i.playerState === 0 && antes !== 0) aoFim(); if (i.playerState === 1) ytTocando = true; } } }); });
    palco.hidden = false; palco.replaceChildren(yt); if (mudo) ytPronto.then(() => ponte?.manda({ event: "command", func: "mute", args: "" }));
  };
  const comando = (func, args = "") => ponte?.manda({ event: "command", func, args });
  return {
    // Num toque da pessoa: libera o som do navegador (celulares só deixam tocar sozinho depois disso)
    destravar() { if (destravado) return; destravado = true; try { const a = maca(), u = URL.createObjectURL(new Blob([SILENCIO], { type: "audio/wav" })); a.src = u; a.play().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(u), 3000)); } catch {} },
    async tocar(f, pos = 0, tocando = true) {
      const g = ++geracao; faixa = f; quer = !!tocando;
      if (f.t === "a") {
        fechaYt(); const a = maca(); a.muted = mudo; if (a.dataset.url !== f.pr) { a.src = f.pr; a.dataset.url = f.pr; }
        await new Promise((ok) => { if (a.readyState >= 1) return ok(); const fim = () => { a.removeEventListener("loadedmetadata", fim); a.removeEventListener("error", fim); ok(); }; a.addEventListener("loadedmetadata", fim); a.addEventListener("error", fim); setTimeout(ok, 8000); });
        if (g !== geracao) return; try { a.currentTime = Math.max(0, Math.min(pos, (a.duration || 30) - 0.2)); } catch {}
        if (tocando) { try { await a.play(); } catch { if (g === geracao) aoBloquear(); } } else a.pause();
      } else {
        audio?.pause(); const igual = yt && ponte?.aberta && yt.dataset.id === f.id; log("yt-tocar", f.id, Math.round(pos), tocando, igual ? "igual" : yt && ponte?.aberta ? "troca" : "abre");
        if (igual) { comando("seekTo", [Math.max(0, pos), true]); comando(tocando ? "playVideo" : "pauseVideo"); ytTocando = tocando; }
        else if (yt && ponte?.aberta) { comando(tocando ? "loadVideoById" : "cueVideoById", [f.id, Math.max(0, pos)]); yt.dataset.id = f.id; ytInfo = { t: pos, em: performance.now(), dur: 0, estado: -1 }; ytTocando = tocando; }
        else { abreYt(f.id, pos, tocando); yt.dataset.id = f.id; }
        if (tocando) setTimeout(() => { if (g === geracao && quer && faixa?.t === "y" && ytInfo.estado !== 1 && ytInfo.estado !== 3) aoBloquear(); }, 6000);
      }
    },
    pausar() { quer = false; if (faixa?.t === "a") audio?.pause(); else if (faixa) { comando("pauseVideo"); ytTocando = false; } },
    retomar() { quer = true; if (faixa?.t === "a") audio?.play().catch(() => aoBloquear()); else if (faixa) { const g = geracao; comando("playVideo"); ytTocando = true; setTimeout(() => { if (g === geracao && quer && faixa?.t === "y" && ytInfo.estado !== 1 && ytInfo.estado !== 3) aoBloquear(); }, 4000); } },
    ir(seg) { if (faixa?.t === "a") { try { audio.currentTime = seg; } catch {} } else if (faixa) comando("seekTo", [seg, true]); },
    posicao() { if (!faixa) return 0; if (faixa.t === "a") return audio?.currentTime || 0; return ytInfo.estado === 1 ? ytInfo.t + (performance.now() - ytInfo.em) / 1000 : ytInfo.t; },
    duracao() { return faixa?.t === "a" ? (Number.isFinite(audio?.duration) ? audio.duration : 30) : ytInfo.dur || null; },
    tocando() { return faixa?.t === "a" ? !!audio && !audio.paused && !audio.ended : ytInfo.estado === 1 || ytInfo.estado === 3; },
    mudo(v) { mudo = !!v; if (audio) audio.muted = mudo; comando(mudo ? "mute" : "unMute"); },
    parar() { geracao++; faixa = null; try { audio?.pause(); } catch {} fechaYt(); },
    get faixa() { return faixa; },
  };
}
