import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analisarLink, acharVideoLink, REDES, HOSTS_PLAYER } from "../videolink.js";

const YT = "dQw4w9WgXcQ", TT = "7234567890123456789";
describe("links de vídeo: só os endereços certos viram cartão", () => {
  test("YouTube Shorts (com e sem www, celular, barra final e lixo de rastreio)", () => {
    for (const u of [`https://www.youtube.com/shorts/${YT}`, `https://youtube.com/shorts/${YT}/`, `https://m.youtube.com/shorts/${YT}?si=abc123&feature=share`, `https://www.youtube.com/shorts/${YT}#x`]) {
      const r = analisarLink(u); assert.equal(r?.rede, "yt", u); assert.equal(r.id, YT); assert.equal(r.url, `https://www.youtube.com/shorts/${YT}`, "endereço limpo, sem rastreio");
      assert.equal(r.embed, `https://www.youtube-nocookie.com/embed/${YT}?playsinline=1&rel=0`);
    }
  });
  test("Instagram Reels (reel, reels, com o perfil na frente e com ?igsh)", () => {
    for (const u of ["https://www.instagram.com/reel/C8aBcD_eFgH/", "https://www.instagram.com/reels/C8aBcD_eFgH/", "https://instagram.com/reel/C8aBcD_eFgH", "https://www.instagram.com/perfil.exemplo/reel/C8aBcD_eFgH/?igsh=MXx4"]) {
      const r = analisarLink(u); assert.equal(r?.rede, "ig", u); assert.equal(r.id, "C8aBcD_eFgH"); assert.equal(r.url, "https://www.instagram.com/reel/C8aBcD_eFgH/"); assert.equal(r.embed, "https://www.instagram.com/reel/C8aBcD_eFgH/embed/");
    }
  });
  test("TikTok (com e sem o idioma /pt-BR/)", () => {
    for (const u of [`https://www.tiktok.com/@fulano/video/${TT}`, `https://www.tiktok.com/pt-BR/@fulano/video/${TT}`, `https://tiktok.com/pt-br/@fulano.sicrano/video/${TT}/?is_from_webapp=1`, `https://m.tiktok.com/@a_b/video/${TT}`]) {
      const r = analisarLink(u); assert.equal(r?.rede, "tt", u); assert.equal(r.id, TT); assert.equal(r.embed, `https://www.tiktok.com/embed/v2/${TT}`);
    }
  });
  test("o que parece, mas não é: servidor parecido, usuário e senha no endereço, porta, http, código errado, outras páginas da mesma rede", () => {
    for (const u of [
      `https://youtube.com.evil.com/shorts/${YT}`, `https://evil.com/shorts/${YT}`, `https://www.youtube.com@evil.com/shorts/${YT}`, `https://www.youtube.com:8443/shorts/${YT}`, `http://www.youtube.com/shorts/${YT}`, `https://notyoutube.com/shorts/${YT}`,
      `https://www.youtube.com/shorts/${YT}x`, "https://www.youtube.com/shorts/curto", `https://www.youtube.com/watch?v=${YT}`, `https://www.youtube.com/shorts/${YT}/extra`, `https://www.youtube.com/embed/${YT}`, `https://youtu.be/${YT}`,
      "https://www.instagram.com/p/C8aBcD_eFgH/", "https://www.instagram.com/reel/", "https://www.instagram.com/reel/ab/", "https://www.instagram.com.evil.com/reel/C8aBcD_eFgH/", "https://instagram.com@evil.com/reel/C8aBcD_eFgH/",
      "https://www.tiktok.com/@fulano", `https://www.tiktok.com/@fulano/video/abc`, `https://www.tiktok.com/@fulano/video/12`, `https://www.tiktok.com/pt-BR/`, `https://vm.tiktok.com/ZMabc/`, `https://tiktok.com.evil.com/@a/video/${TT}`, `https://evil.com/?u=https://www.tiktok.com/@a/video/${TT}`,
      "javascript:alert(1)", "data:text/html,x", "", "nao e link",
    ]) assert.equal(analisarLink(u), null, u);
  });
  test("o endereço do player nunca contém texto vindo do link além do código já validado", () => {
    const r = analisarLink(`https://www.tiktok.com/@a"onload=x/video/${TT}`); assert.equal(r, null, "usuário com aspas é recusado");
    for (const u of [`https://www.youtube.com/shorts/${YT}`, "https://www.instagram.com/reel/C8aBcD_eFgH/", `https://www.tiktok.com/@fulano/video/${TT}`]) { const r2 = analisarLink(u); assert.ok(HOSTS_PLAYER.some((h) => r2.embed.startsWith(h + "/")), r2.embed); assert.doesNotMatch(r2.embed, /["'<>\s]/); }
  });
});

describe("acharVideoLink: dentro de um texto", () => {
  test("acha o primeiro link e devolve o nome da rede", () => {
    const r = acharVideoLink(`olha isso kkkk https://www.youtube.com/shorts/${YT}?si=zz e esse https://www.tiktok.com/@a/video/${TT}`);
    assert.equal(r.rede, "yt"); assert.equal(r.nome, REDES.yt.nome); assert.equal(r.site, "YouTube"); assert.equal(r.original, `https://www.youtube.com/shorts/${YT}?si=zz`);
  });
  test("pontuação e parênteses colados no link não atrapalham; link no meio de várias linhas também", () => {
    for (const t of [`(https://www.youtube.com/shorts/${YT})`, `https://www.youtube.com/shorts/${YT}!!`, `<https://www.youtube.com/shorts/${YT}>.`, `veja:\nhttps://www.youtube.com/shorts/${YT}\nvaleu`, `"https://www.youtube.com/shorts/${YT}",`]) assert.equal(acharVideoLink(t)?.id, YT, t);
  });
  test("texto sem link, com link de outro tipo, vazio ou que não é texto: nada", () => {
    for (const t of ["", "só conversa", "https://example.com/video", `youtube.com/shorts/${YT}`, `www.youtube.com/shorts/${YT}`, null, undefined, 42, {}]) assert.equal(acharVideoLink(t), null, String(t));
  });
  test("um link ruim antes não esconde um bom depois", () => assert.equal(acharVideoLink(`https://evil.com/x https://www.youtube.com/shorts/${YT}`)?.id, YT));
});
