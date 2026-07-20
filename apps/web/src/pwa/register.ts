import { registerSW } from "virtual:pwa-register";

export const LEGACY_OPENFREEMAP_CACHE = "openfreemap-v1";
export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1_000;

let updateIntervalId: number | undefined;
let removeControllerChangeListener: (() => void) | undefined;

export async function deleteLegacyOpenFreeMapCache(
  cacheStorage: Pick<CacheStorage, "delete"> | undefined = globalThis.caches,
): Promise<boolean> {
  if (!cacheStorage) return false;

  try {
    return await cacheStorage.delete(LEGACY_OPENFREEMAP_CACHE);
  } catch {
    // Cache Storage can be unavailable in private browsing or constrained contexts.
    // A failed cleanup must never prevent the application from starting.
    return false;
  }
}

async function requestRegistrationUpdate(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  try {
    await registration.update();
  } catch {
    // Update checks routinely fail while offline. The next hourly check retries it.
  }
}

function stopRegistrationMaintenance(): void {
  if (updateIntervalId !== undefined) {
    window.clearInterval(updateIntervalId);
    updateIntervalId = undefined;
  }
  removeControllerChangeListener?.();
  removeControllerChangeListener = undefined;
}

export function registerServiceWorker(): void {
  stopRegistrationMaintenance();
  void deleteLegacyOpenFreeMapCache();

  registerSW({
    immediate: true,
    onRegisteredSW(_serviceWorkerUrl, registration) {
      if (!registration) return;

      stopRegistrationMaintenance();
      void deleteLegacyOpenFreeMapCache();
      void requestRegistrationUpdate(registration);

      updateIntervalId = window.setInterval(
        () => void requestRegistrationUpdate(registration),
        SERVICE_WORKER_UPDATE_INTERVAL_MS,
      );

      if ("serviceWorker" in navigator) {
        const handleControllerChange = (): void => {
          void deleteLegacyOpenFreeMapCache();
        };
        navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
        removeControllerChangeListener = () =>
          navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      }
    },
  });
}
