// Guarda de entrada. Roda ANTES do app e só carrega o app se o ambiente for seguro.
// 1) Navegadores embutidos (Instagram, Facebook, TikTok, WebView...): o aplicativo que os hospeda consegue
//    executar código dentro da página e ler o que aparece nela (mensagens já decifradas) e o que ela guarda.
// 2) Dentro de moldura (iframe) de outro site: protege contra clique disfarçado (clickjacking).
// Se bloquear, o app não chega a ser carregado: nenhuma chave é aberta e nenhum banco local é criado.
(function () {
  try { const t = localStorage.getItem("lacre:tema"); if (t === "claro" || t === "escuro") document.documentElement.dataset.tema = t; } catch {} // aparência escolhida: aplica já, antes de desenhar a tela
  const ua = navigator.userAgent || "";
  const embutido = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|musical_ly|TikTok|BytedanceWebview|Snapchat|MicroMessenger|\bGSA\/|Line\/|; wv\)/i.test(ua);
  let emMoldura = false;
  try { emMoldura = window.top !== window.self; } catch { emMoldura = true; } // acesso negado ao topo = estamos em moldura de outro site
  if (!embutido && !emMoldura) {
    import("./app.js?v=3db2de6243").catch(() => bloquear("Não foi possível carregar o Lacre.", "Recarregue a página. Se continuar, tente de novo em alguns minutos.", false));
    return;
  }
  const android = /Android/i.test(ua);
  if (emMoldura) {
    bloquear("O Lacre não roda dentro de outro site.", "Por segurança, abra o Lacre diretamente no navegador.", false, true);
  } else {
    bloquear("Abra o Lacre no navegador de verdade.",
      "Dentro do Instagram, Facebook e outros aplicativos, quem criou o aplicativo consegue enxergar o que aparece na tela, inclusive suas mensagens. Toque no menu (⋮ ou …) e escolha “Abrir no navegador” (Chrome ou Safari). Depois, em “Adicionar à tela inicial”, o Lacre vira um ícone no seu celular.",
      android);
  }

  function bloquear(titulo, texto, comIntent, comLink) {
    const mostrar = () => {
      const caixa = document.createElement("main"); caixa.className = "bloqueio"; caixa.setAttribute("role", "alert");
      const h = document.createElement("h1"); h.textContent = titulo;
      const p = document.createElement("p"); p.textContent = texto;
      caixa.append(h, p);
      if (comIntent) { // Android: tenta abrir direto no Chrome
        const a = document.createElement("a"); a.className = "botao"; a.textContent = "Abrir no Chrome";
        a.href = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
        caixa.append(a);
      }
      if (comLink) {
        const a = document.createElement("a"); a.className = "botao"; a.textContent = "Abrir o Lacre"; a.href = location.href; a.target = "_blank"; a.rel = "noopener";
        caixa.append(a);
      }
      const copiar = document.createElement("button"); copiar.type = "button"; copiar.className = "botao sec"; copiar.textContent = "Copiar o endereço";
      copiar.onclick = async () => { try { await navigator.clipboard.writeText(location.href); copiar.textContent = "Endereço copiado"; } catch { copiar.textContent = location.href; } };
      caixa.append(copiar);
      document.body.replaceChildren(caixa); // some a tela de login e tudo o mais
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mostrar) : mostrar();
  }
})();
