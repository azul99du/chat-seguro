// Remoção de metadados de vídeo (MP4/MOV) e cifra de arquivos. Os testes de vídeo precisam do ffmpeg.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanVideo, sealBytes, openBytes } from "../media.js";
import { hasFfmpeg, tmp, makeVideo, probe, decodes } from "./helpers/fixtures.mjs";

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
