// Service worker do Lacre: só recebe os avisos push e mostra uma notificação SEM conteúdo ("Você tem uma nova mensagem").
// Não guarda nada em cache e não toca em chaves nem mensagens.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (janelas.some((c) => c.visibilityState === "visible")) return; // o Lacre está aberto na tela: a própria tela já mostra a mensagem
    await self.registration.showNotification("Lacre", { body: "Você tem uma nova mensagem", tag: "lacre", renotify: true, icon: "icon-192.png", badge: "icon-192.png", data: { destino: self.registration.scope } });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const j of janelas) { try { await j.focus(); return; } catch {} }
    await self.clients.openWindow(e.notification.data?.destino || self.registration.scope);
  })());
});
