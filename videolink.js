// Reconhece links de vídeo curto do YouTube Shorts, Instagram Reels e TikTok. Função pura: não depende do navegador, então é testada em Node.
// SÓ links exatamente nesses endereços viram cartão de vídeo (nada de "contém youtube.com"): o endereço é lido com URL(), o servidor é conferido por inteiro
// e o código do vídeo precisa ter o formato certo. O que sobra do link (?igsh=..., ?si=...) é descartado: o vídeo é aberto por um endereço limpo, montado aqui.
export const REDES = {
  yt: { nome: "YouTube Shorts", site: "YouTube", cor: "yt" },
  ig: { nome: "Instagram Reels", site: "Instagram", cor: "ig" },
  tt: { nome: "TikTok", site: "TikTok", cor: "tt" },
};
const HOSTS = {
  yt: ["www.youtube.com", "youtube.com", "m.youtube.com"],
  ig: ["www.instagram.com", "instagram.com"],
  tt: ["www.tiktok.com", "tiktok.com", "m.tiktok.com"],
};
// quem aparece no endereço do player (a lista da política de segurança do index.html tem de ter exatamente estes)
export const HOSTS_PLAYER = ["https://www.youtube-nocookie.com", "https://www.instagram.com", "https://www.tiktok.com"];

export function analisarLink(token) {
  let u; try { u = new URL(token); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase(), p = u.pathname; let m;
  if (HOSTS.yt.includes(host) && (m = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(p)))
    return { rede: "yt", id: m[1], url: `https://www.youtube.com/shorts/${m[1]}`, embed: `https://www.youtube-nocookie.com/embed/${m[1]}?playsinline=1&rel=0` };
  if (HOSTS.ig.includes(host) && (m = /^\/(?:[A-Za-z0-9._]{1,30}\/)?reels?\/([A-Za-z0-9_-]{5,30})\/?$/.exec(p)))
    return { rede: "ig", id: m[1], url: `https://www.instagram.com/reel/${m[1]}/`, embed: `https://www.instagram.com/reel/${m[1]}/embed/` };
  if (HOSTS.tt.includes(host) && (m = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?@([A-Za-z0-9._]{1,40})\/video\/(\d{6,25})\/?$/.exec(p)))
    return { rede: "tt", id: m[2], url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, embed: `https://www.tiktok.com/embed/v2/${m[2]}` };
  return null;
}
// O primeiro link de vídeo de um texto (ou null). Tira pontuação colada no link: "olha https://... !!"
export function acharVideoLink(texto) {
  for (let t of String(texto ?? "").split(/\s+/)) {
    t = t.replace(/^[(<\[“"']+/, "").replace(/[)>\].,;:!?”"']+$/, "");
    if (!/^https:\/\//i.test(t)) continue;
    const r = analisarLink(t); if (r) return { ...r, ...REDES[r.rede], original: t };
  }
  return null;
}
