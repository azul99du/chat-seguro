// Remoção de metadados de vídeo (MP4/MOV) e cifra de arquivos. Os testes de vídeo precisam do ffmpeg.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanVideo, cleanAudio, sealBytes, openBytes } from "../media.js";
import { hasFfmpeg, tmp, makeVideo, makeAudio, probe, decodes } from "./helpers/fixtures.mjs";

const SECRETS = ["SEGREDO"]; // texto simples; GPS e data são guardados em formato próprio e são checados pelo ffprobe e pelo bloco loci
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const skip = hasFfmpeg() ? false : "ffmpeg não instalado";

describe("limpeza de vídeo", { skip }, () => {
  for (const [nome, opts] of [["MP4 comum", {}], ["MP4 faststart (moov antes do mdat)", { faststart: true }], ["MOV", { mov: true }]]) {
    test(nome, () => {
      const dir = tmp(), src = makeVideo(dir, "in.mp4", opts), orig = readFileSync(src);
      assert.ok(SECRETS.every((s) => orig.toString("latin1").includes(s)), "o arquivo de teste precisa ter os metadados");
      const tagsOrig = probe(src, "-show_entries", "format_tags", "-of", "default=nw=1");
      assert.match(tagsOrig, /creation_time=2019/, "o original tem a data de criação");
      assert.match(tagsOrig, /location=\+12\.3456-045\.6789/, "o original tem o GPS");
      const blocosGps = opts.mov ? [Buffer.from([0xa9, 0x78, 0x79, 0x7a])] : [Buffer.from("loci")]; // MOV guarda o GPS em ©xyz; MP4 em loci
      assert.ok(blocosGps.every((b) => orig.includes(b)) && orig.includes("udta"), "o original tem o bloco de GPS e udta");
      const out = Buffer.from(cleanVideo(ab(orig)));
      const dst = join(dir, "out.mp4"); writeFileSync(dst, out);
      const txt = out.toString("latin1");
      assert.deepEqual(SECRETS.filter((s) => txt.includes(s)), [], "nenhum metadado pode sobrar");
      assert.ok(!blocosGps.some((b) => out.includes(b)) && !out.includes("udta") && !out.includes("ilst"), "bloco de GPS, udta e ilst removidos");
      assert.equal(out.length, orig.length, "mesmo tamanho: os deslocamentos internos continuam válidos");
      assert.ok(decodes(dst), "o vídeo continua decodificando");
      const tipos = probe(dst, "-show_entries", "stream=codec_type", "-of", "csv=p=0").trim().split(/\s+/);
      assert.deepEqual(tipos.sort(), ["audio", "video"], "faixa de timecode/dados removida; áudio e vídeo mantidos");
      const tags = probe(dst, "-show_entries", "format_tags:stream_tags", "-of", "default=nw=1");
      assert.doesNotMatch(tags, /SEGREDO|creation_time|2019|location|12\.3456|title|comment/);
      const quadros = probe(dst, "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0").trim();
      assert.equal(quadros, "30", "todos os quadros preservados (sem recodificar)");
    });
  }
  test("arquivo que não é MP4 é recusado com mensagem clara", () => {
    assert.throws(() => cleanVideo(new Uint8Array(100).buffer), /MP4 ou MOV/);
    assert.throws(() => cleanVideo(new TextEncoder().encode("isto não é um vídeo de verdade, apenas texto").buffer), /MP4 ou MOV/);
  });
});

describe("cifra de arquivo (AES-GCM, chave aleatória por arquivo)", () => {
  test("vai e volta; chaves e iv diferentes a cada vez; texto claro some", async () => {
    const dados = new TextEncoder().encode("conteudo secreto da foto".repeat(100));
    const a = await sealBytes(dados), b = await sealBytes(dados);
    assert.notEqual(a.key, b.key); assert.notEqual(a.iv, b.iv);
    assert.ok(!Buffer.from(a.data).toString("latin1").includes("secreto"));
    assert.deepEqual(await openBytes(a.data, a.key, a.iv), dados);
  });
  test("chave errada ou arquivo adulterado não abre", async () => {
    const a = await sealBytes(new TextEncoder().encode("abc")), b = await sealBytes(new TextEncoder().encode("abc"));
    await assert.rejects(openBytes(a.data, b.key, a.iv));
    const adult = new Uint8Array(a.data); adult[0] ^= 1;
    await assert.rejects(openBytes(adult, a.key, a.iv));
  });
});

describe("limpeza de áudio", { skip }, () => {
  const SEGREDOS = ["SEGREDO"];
  for (const [formato, mime] of [["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["m4a", "audio/mp4"], ["webm", "audio/webm"]]) {
    test(`${formato.toUpperCase()}: tags, artista, título, comentário, GPS e data saem; continua decodificando`, () => {
      const dir = tmp(), src = makeAudio(dir, formato), orig = readFileSync(src);
      assert.ok(orig.toString("latin1").includes("SEGREDO") || formato === "webm", "o arquivo de teste precisa ter os metadados");
      const r = cleanAudio(ab(orig), { gravado: formato === "webm" });
      assert.equal(r.mime, mime);
      const dst = join(dir, "out." + formato); writeFileSync(dst, r.bytes);
      const txt = Buffer.from(r.bytes).toString("latin1");
      assert.deepEqual(SEGREDOS.filter((x) => txt.includes(x)), [], "nenhum metadado pode sobrar");
      assert.ok(decodes(dst), "o áudio continua decodificando");
      const tags = probe(dst, "-show_entries", "format_tags:stream_tags", "-of", "default=nw=1");
      assert.doesNotMatch(tags, /SEGREDO|location|creation_time|2019|12\.3456|artist|album|comment|=Lavf/i);
      const dur = Number(probe(dst, "-show_entries", "format=duration", "-of", "csv=p=0")); assert.ok(Math.abs(dur - 2) < 0.2, `duração preservada (${dur}s)`);
    });
  }
  test("MP3: ID3v2 no início e ID3v1 no fim são removidos (os quadros ficam intactos)", () => {
    const orig = readFileSync(makeAudio(tmp(), "mp3")), r = cleanAudio(ab(orig));
    assert.equal(Buffer.from(orig.subarray(0, 3)).toString(), "ID3"); assert.equal(Buffer.from(orig.subarray(orig.length - 128, orig.length - 125)).toString(), "TAG");
    assert.ok(!Buffer.from(r.bytes.subarray(0, 3)).equals(Buffer.from("ID3")));
    assert.equal(r.bytes[0], 0xff); assert.ok(r.bytes.length < orig.length - 128);
  });
  test("WebM de arquivo (não gravado pelo app) e formatos desconhecidos são recusados com mensagem clara", () => {
    const webm = readFileSync(makeAudio(tmp(), "webm"));
    assert.throws(() => cleanAudio(ab(webm)), /Formato não suportado/);
    assert.throws(() => cleanAudio(new TextEncoder().encode("isto não é um áudio de verdade, só texto comprido").buffer), /Formato não suportado|limpar/);
    assert.throws(() => cleanAudio(new Uint8Array(4).buffer), /limpar/);
  });
});
