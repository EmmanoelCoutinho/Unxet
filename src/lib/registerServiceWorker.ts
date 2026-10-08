// Importado antes do App em index.tsx: o registro roda mesmo que o app
// falhe ao carregar, para que uma versão nova do service worker sempre chegue.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Falha ao registrar o service worker", error);
    });
  });
}

export {};
