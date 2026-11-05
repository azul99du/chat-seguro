// Arquivos de teste gerados na hora (nada binário no repositório). Precisam do ffmpeg.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const hasFfmpeg = () => spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
export const tmp = () => mkdtempSync(join(tmpdir(), "lacre-"));
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: "pipe" });

// Vídeo com metadados "secretos": título, GPS, comentário, data, nome do handler e uma faixa de timecode.
export function makeVideo(dir, name, { faststart = false, mov = false } = {}) {
  const out = join(dir, name);
  ff("-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-f", "lavfi", "-i", "sine=duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", ...(faststart ? ["-movflags", "+faststart"] : []),
    "-timecode", "01:02:03:04", "-metadata", "title=SEGREDOTITULO", "-metadata", "location=+12.3456-045.6789/",
    "-metadata", "comment=SEGREDOCOMENT", "-metadata", "creation_time=2019-03-04T05:06:07Z",
    "-metadata:s:v:0", "handler_name=SEGREDOHANDLER", ...(mov ? ["-f", "mov"] : []), out);
  return out;
}

// JPEG 640x360 com EXIF (fabricante "SEGREDOMAKE", orientação 6 = girar 90°) e comentário com "GPS".
export function makeJpegWithExif(dir, name = "foto.jpg") {
  const raw = join(dir, "raw.jpg");
  ff("-f", "lavfi", "-i", "testsrc=size=640x360:rate=1", "-frames:v", "1", "-q:v", "3", raw);
  const jpg = readFileSync(raw);
  const make = Buffer.from("SEGREDOMAKE\0"), n = 2, ifd = 2 + n * 12 + 4, dataOff = 8 + ifd;
  const tiff = Buffer.alloc(8 + ifd + make.length);
  tiff.write("II", 0); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  let o = 8; tiff.writeUInt16LE(n, o); o += 2;
  tiff.writeUInt16LE(0x010f, o); tiff.writeUInt16LE(2, o + 2); tiff.writeUInt32LE(make.length, o + 4); tiff.writeUInt32LE(dataOff, o + 8); o += 12;
  tiff.writeUInt16LE(0x0112, o); tiff.writeUInt16LE(3, o + 2); tiff.writeUInt32LE(1, o + 4); tiff.writeUInt16LE(6, o + 8); o += 12;
  make.copy(tiff, dataOff);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const seg = (marker, body) => { const h = Buffer.alloc(4); h.writeUInt16BE(marker, 0); h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
  const com = seg(0xfffe, Buffer.from("GPS -23.5505 -46.6333 SEGREDOCOMENTARIO"));
  const out = Buffer.concat([jpg.subarray(0, 2), seg(0xffe1, app1), com, jpg.subarray(2)]);
  const file = join(dir, name); writeFileSync(file, out); return file;
}
export const probe = (file, ...args) => execFileSync("ffprobe", ["-v", "error", ...args, file], { encoding: "utf8" });
export const decodes = (file) => spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]).status === 0;
