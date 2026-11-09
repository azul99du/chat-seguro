// Compressão de vídeo (video.js) no navegador de verdade: o resultado precisa ser um MP4 H.264 válido, 720p, com o áudio original, sem metadados e MENOR.
// Não usa o Supabase: serve só os arquivos do site.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { hasFfmpeg, tmp } from "./helpers/fixtures.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), ".."), dir = tmp();
let srv, url, browser, page;
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: "pipe" });
const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", f], { encoding: "utf8" }));
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (hasFfmpeg() ? fn(c) : c.skip("ffmpeg não instalado")));
before(async () => {
  if (!hasFfmpeg()) return;
  srv = createServer((q, r) => { const f = join(raiz, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(raiz) || !existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { "content-type": extname(f) === ".js" ? "text/javascript" : "text/html" }).end(readFileSync(f)); }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r)); url = `http://127.0.0.1:${srv.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); page = await browser.newPage(); await page.goto(url + "package.json");
  // fixtures
  ff("-f", "lavfi", "-i", "testsrc2=duration=4:size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "12M", "-g", "60", "-bf", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "title=SEGREDOTITULO", "-metadata", "location=+12.3456-045.6789/", join(dir, "paisagem.mp4"));
  ff("-display_rotation:v:0", "90", "-i", join(dir, "paisagem.mp4"), "-c", "copy", join(dir, "retrato.mp4"));
  ff("-f", "lavfi", "-i", "testsrc2=duration=3:size=640x360:rate=30", "-c:v", "libx264", "-b:v", "500k", "-pix_fmt", "yuv420p", join(dir, "pequeno.mp4"));
  ff("-f", "lavfi", "-i", "testsrc2=duration=3:size=1280x720:rate=60", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "10M", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, "60fps.mp4"));
  ff("-f", "lavfi", "-i", "testsrc2=duration=3:size=1920x1080:rate=30", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "12M", "-pix_fmt", "yuv420p", join(dir, "mudo.mp4"));
});
after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

async function comprimir(arquivo) {
  await page.setContent('<input type="file" id="f">'); await page.setInputFiles("#f", arquivo);
  const r = await page.evaluate(async (u) => {
    const m = await import(u + "video.js"); const f = document.getElementById("f").files[0], prog = [];
    const o = await m.comprimirVideo(f, { onProgresso: (p) => prog.push(p) });
    if (!o) return null;
    let b = ""; for (let i = 0; i < o.bytes.length; i += 8192) b += String.fromCharCode(...o.bytes.subarray(i, i + 8192));
    // o navegador precisa conseguir TOCAR o resultado
    const v = document.createElement("video"), blob = new Blob([o.bytes], { type: "video/mp4" }); v.muted = true; v.src = URL.createObjectURL(blob);
    const ok = await new Promise((res) => { v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, d: v.duration }); v.onerror = () => res(null); setTimeout(() => res(null), 8000); });
    return { b64: btoa(b), largura: o.largura, altura: o.altura, duracao: o.duracao, prog, toca: ok };
  }, url);
  if (!r) return null; const out = join(dir, "saida-" + Date.now() + ".mp4"); writeFileSync(out, Buffer.from(r.b64, "base64")); return { ...r, out };
}
const decodifica = (f) => spawnSync("ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim();

t("1080p com B-frames e áudio: sai 720p H.264, menor, com o MESMO áudio e a mesma duração; decodifica sem erros e o navegador toca", async () => {
  const orig = join(dir, "paisagem.mp4"), o = await comprimir(orig); assert.ok(o, "comprimiu");
  const p = probe(o.out), v = p.streams.find((s) => s.codec_type === "video"), a = p.streams.find((s) => s.codec_type === "audio"), po = probe(orig), ao = po.streams.find((s) => s.codec_type === "audio");
  assert.equal(v.codec_name, "h264"); assert.equal(v.width, 1280); assert.equal(v.height, 720); assert.match(v.pix_fmt, /^yuvj?420p$/); assert.ok(["pc", "tv"].includes(v.color_range) && v.color_space === "bt709", "a faixa de cor e o padrão de cor estão declarados (cores certas em qualquer player)");
  assert.ok(Math.abs(Number(p.format.duration) - Number(po.format.duration)) < 0.25, `duração ${p.format.duration} x ${po.format.duration}`);
  assert.equal(a?.codec_name, "aac"); assert.equal(a.nb_read_frames, ao.nb_read_frames, "áudio idêntico (mesmo número de quadros)");
  assert.ok(Math.abs(Number(v.nb_read_frames) - 120) <= 3, "quadros: " + v.nb_read_frames);
  assert.ok(Number(p.format.size) < Number(po.format.size) * 0.5, `menor: ${p.format.size} x ${po.format.size}`);
  assert.equal(decodifica(o.out), "", "o ffmpeg decodifica sem nenhum aviso");
  assert.ok(o.toca && o.toca.w === 1280 && o.toca.h === 720, "o navegador abre e toca: " + JSON.stringify(o.toca));
  const bruto = readFileSync(o.out).toString("latin1"); // (o áudio é copiado sem mexer: o ffmpeg grava o próprio nome, "Lavc", dentro do fluxo AAC; celulares não fazem isso. Por isso "Lavc" fica fora desta lista.)
  assert.ok(!/SEGREDO|udta|meta|\xA9xyz|Lavf|x264/.test(bruto), "nenhum metadado nem nome de programa nas caixas e no vídeo");
  assert.ok(o.prog.length > 0 && o.prog.at(-1) === 1 && o.prog.every((x, i) => i === 0 || x >= o.prog[i - 1]), "o progresso só sobe e termina em 100%");
});
t("retrato (gravado de lado, com rotação no arquivo): continua em pé depois de comprimir", async () => {
  const o = await comprimir(join(dir, "retrato.mp4")); assert.ok(o, "comprimiu");
  const v = probe(o.out).streams.find((s) => s.codec_type === "video"), rot = v.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? 0;
  assert.equal(Math.abs(rot), 90, "a rotação foi mantida"); assert.equal(decodifica(o.out), "");
  assert.ok(o.toca && o.toca.h > o.toca.w, "o navegador mostra em pé: " + JSON.stringify(o.toca));
});
t("já é pequeno e leve (640x360, 500 kbps): não mexe (devolve null, o original segue o caminho de sempre)", async () => assert.equal(await comprimir(join(dir, "pequeno.mp4")), null));
t("60 fps: sai com no máximo ~30 fps (descarta quadros) e continua com o áudio e a duração", async () => {
  const o = await comprimir(join(dir, "60fps.mp4")); assert.ok(o); const p = probe(o.out), v = p.streams.find((s) => s.codec_type === "video");
  assert.ok(Number(v.nb_read_frames) <= 100 && Number(v.nb_read_frames) >= 80, "~30 fps em 3 s: " + v.nb_read_frames); assert.ok(p.streams.some((s) => s.codec_type === "audio")); assert.ok(Math.abs(Number(p.format.duration) - 3) < 0.25); assert.equal(decodifica(o.out), "");
});
t("vídeo sem áudio também funciona", async () => { const o = await comprimir(join(dir, "mudo.mp4")); assert.ok(o); const p = probe(o.out); assert.equal(p.streams.filter((s) => s.codec_type === "audio").length, 0); assert.equal(decodifica(o.out), ""); });
t("arquivo que não é MP4 (ou está quebrado) não derruba nada: devolve null", async () => {
  writeFileSync(join(dir, "lixo.mp4"), Buffer.from("isto não é um vídeo, só texto qualquer".repeat(50))); assert.equal(await comprimir(join(dir, "lixo.mp4")), null);
  const buf = readFileSync(join(dir, "paisagem.mp4")); writeFileSync(join(dir, "cortado.mp4"), buf.subarray(0, Math.floor(buf.length / 3))); assert.equal(await comprimir(join(dir, "cortado.mp4")), null);
});
