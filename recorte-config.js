// ===== CONFIGURAÇÕES DO RECORTADOR: mude só os valores =====
// (as mesmas do notebook recortador_figurinhas_sam2; MODELO fica fixo: no navegador só roda o SAM 2.1 "tiny" em ONNX)
export const NOTA_MINIMA = 0.6;   // 0 = sempre o recorte maior (objeto inteiro), 1 = só o de maior nota
export const BORDA_MIN = 0.35;    // abaixo disso a máscara vira 0 (lógica do Instagram)
export const BORDA_MAX = 0.90;    // acima disso vira 1
export const BURACO_MAX = 0.15;   // buracos dentro do objeto até essa fração da área também ficam opacos
export const MIOLO_PX = 3;        // só esta faixa da borda fica transparente; o miolo vira opaco (0 = desligado)
export const SUAVIZAR = 1.0;      // desfoque da borda em pixels (0 = nenhum)
export const CONTORNO_PX = 14;    // espessura do contorno branco em pixels da figurinha (0 = sem contorno)
export const COR_R = 255;
export const COR_G = 255;
export const COR_B = 255;
export const TAMANHO = 512;       // lado da figurinha final
export const MARGEM_PX = 8;       // espaço extra em volta do contorno
export const LADO_PROCESSO = 1024; // lado maior da foto usada na tela e na máscara
export const KB_MAXIMO = 100;     // limite do WhatsApp
export const LARGURA_TELA = 600;  // largura máxima da foto na tela de clique
