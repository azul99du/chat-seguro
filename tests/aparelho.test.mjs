import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { descreverAparelho } from "../supabase/functions/aparelho/ua.js";

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
  tabletAndroid: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};
test("o navegador vira rótulos legíveis (navegador, sistema, tipo)", () => {
  assert.deepEqual(descreverAparelho(UA.chromeAndroid), { navegador: "Chrome", sistema: "Android", tipo: "celular" });
  assert.deepEqual(descreverAparelho(UA.chromeWindows), { navegador: "Chrome", sistema: "Windows", tipo: "computador" });
  assert.deepEqual(descreverAparelho(UA.safariIphone), { navegador: "Safari", sistema: "iOS", tipo: "celular" });
  assert.deepEqual(descreverAparelho(UA.edge), { navegador: "Edge", sistema: "Windows", tipo: "computador" });
  assert.deepEqual(descreverAparelho(UA.samsung), { navegador: "Samsung Internet", sistema: "Android", tipo: "celular" });
  assert.deepEqual(descreverAparelho(UA.firefoxMac), { navegador: "Firefox", sistema: "macOS", tipo: "computador" });
  assert.equal(descreverAparelho(UA.tabletAndroid).tipo, "tablet");
});
test("texto vazio, estranho ou enorme não quebra e não vaza nada além dos rótulos", () => {
  assert.deepEqual(descreverAparelho(""), { navegador: "Navegador desconhecido", sistema: "Sistema desconhecido", tipo: "outro" });
  assert.deepEqual(Object.keys(descreverAparelho("x".repeat(100000))), ["navegador", "sistema", "tipo"]);
});
test("a função e o banco NÃO guardam o IP nem o texto bruto do navegador", () => {
  const fn = readFileSync(new URL("../supabase/functions/aparelho/index.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  const insercao = fn.match(/\.insert\(\{[^}]*\}/)[0];
  assert.doesNotMatch(insercao, /\bip\b|user_agent|ua\b/i, "o insert não leva IP nem user-agent");
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"), tabela = sql.match(/create table public\.aparelhos \([\s\S]*?\n\);/)[0];
  assert.doesNotMatch(tabela, /\bip\b|ip_|user_agent|inet/i, "a tabela não tem coluna de IP nem de user-agent");
  assert.match(sql, /revoke all on public\.aparelhos from anon, authenticated/); assert.match(sql, /alter table public\.aparelhos enable row level security/);
  assert.match(fn, /verify_jwt|role !== "authenticated"/, "a função confere que é uma sessão logada");
});
