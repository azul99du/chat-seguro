// Pop-up de mensagem nova (no alto da tela): o que mostrar e quando. Partes puras (testadas em Node); o app desenha e cuida do toque.
import { resumo, MAX_PREVIEW } from "./reply.js?v=381ebc61e3";
export const POP_MS = 4000; // fica na tela por 4 s (parado enquanto a pessoa segura ou passa o mouse)
const ROTULO = { image: "Foto", video: "Vídeo", audio: "Áudio", sticker: "Figurinha", musica: "Música" };

// Texto curto do aviso, ou null se esse tipo de conteúdo não merece aviso (reação, "oi" interno, apagar...)
export function previaDe(c) {
  const r = resumo(c); if (!r) return null;
  if (r.kind === "text") return r.text.trim() ? r.text : null;
  const rot = ROTULO[r.kind] || "Mensagem"; const t = r.text.trim();
  if (r.kind === "musica") return t ? `Música: ${t}` : "Música";
  return t ? `${rot}: ${t}` : rot;
}
export const tituloDoAviso = (grupoNome, quemNome) => (grupoNome ? `${grupoNome} · @${quemNome}` : `@${quemNome}`);

// Mostra o aviso? Só com o site à vista, em tempo real, fora da conversa onde a mensagem chegou e sem nenhuma janela aberta por cima.
export const devePop = ({ visivel, aoVivo, conversaAberta, janelaAberta, desligado }) => !!visivel && !!aoVivo && !conversaAberta && !janelaAberta && !desligado;
export { MAX_PREVIEW };
