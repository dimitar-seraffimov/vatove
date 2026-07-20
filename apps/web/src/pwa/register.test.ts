// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSW } from "virtual:pwa-register";
import {
  deleteLegacyOpenFreeMapCache,
  LEGACY_OPENFREEMAP_CACHE,
  registerServiceWorker,
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
} from "./register";

vi.mock("virtual:pwa-register", () => ({ registerSW: vi.fn() }));

describe("service worker registration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(registerSW).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("removes the legacy map cache without propagating Cache Storage failures", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    await expect(
      deleteLegacyOpenFreeMapCache({ delete: deleteCache }),
    ).resolves.toBe(true);
    expect(deleteCache).toHaveBeenCalledWith(LEGACY_OPENFREEMAP_CACHE);

    await expect(
      deleteLegacyOpenFreeMapCache({ delete: vi.fn().mockRejectedValue(new Error("denied")) }),
    ).resolves.toBe(false);
    await expect(deleteLegacyOpenFreeMapCache(undefined)).resolves.toBe(false);
  });

  it("cleans stale tiles and checks for updates immediately, hourly, and on controller changes", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });

    const serviceWorker = new EventTarget();
    Object.defineProperty(serviceWorker, "controller", { value: {} });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    const update = vi.fn().mockResolvedValue(undefined);
    const registration = { update } as unknown as ServiceWorkerRegistration;

    registerServiceWorker();
    const options = vi.mocked(registerSW).mock.calls[0]?.[0];
    expect(options?.immediate).toBe(true);
    expect(deleteCache).toHaveBeenCalledTimes(1);

    options?.onRegisteredSW?.("/service-worker.js", registration);
    await vi.runAllTicks();
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_UPDATE_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);

    serviceWorker.dispatchEvent(new Event("controllerchange"));
    await vi.runAllTicks();
    expect(deleteCache).toHaveBeenCalledTimes(3);
  });
});
