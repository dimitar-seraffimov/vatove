import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(serviceWorkerUrl, registration) {
      if (!serviceWorkerUrl || !registration) return;
      window.setInterval(() => void registration.update(), 60 * 60 * 1_000);
    },
  });
}
