/**
 * Finding and starting the photo engine (Q5: moved out of App.tsx unchanged): checks the
 * system, starts the engine if needed, shakes hands with it, loads the saved settings, then
 * keeps a light 15-second heartbeat. Also the "Start engine" and "Check again" actions of the
 * startup banner.
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SystemPrerequisites } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, performHandshake } from "../services/api";

/** `onConnected` runs each time the engine is reached (load the library, the vault status…). */
export function useEngineConnection(onConnected: () => void) {
  const { setPrerequisites, setEngineConfig, setIsEngineReady, setTheme, setGridDensity } = useAppStore();
  const [isRecheckingPrereqs, setIsRecheckingPrereqs] = useState(false);
  const connected = useRef(onConnected);
  connected.current = onConnected;

  // Manual engine launch helper
  const startEngine = async () => {
    try {
      const result = await invoke<{ status?: string; message?: string }>("start_backend_engine");
      if (result?.status === "error") {
        // M5: e.g. no secure access key could be made; the banner shows the same reason.
        useAppStore.getState().showToast(result.message || "The engine couldn't start. Please try again.", "warning");
        await recheckPrerequisites();
        return;
      }
      useAppStore.getState().showToast("Starting the engine…", "info");
      // The engine needs a few seconds to boot; keep checking so one click is enough.
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await recheckPrerequisites()) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error("Failed to start engine:", err);
      useAppStore.getState().showToast("Failed to launch background engine", "warning");
    }
  };

  // Manual / button-triggered prerequisites re-check
  const recheckPrerequisites = async (): Promise<boolean> => {
    setIsRecheckingPrereqs(true);
    try {
      const prereqs = await invoke<SystemPrerequisites>("check_system_prerequisites");
      setPrerequisites(prereqs);
      if (prereqs.backend.running) {
        const config = await invoke<{ port: number; token: string; base_url: string }>("get_engine_config");
        if (config && config.port > 0) {
          setEngineConfig(config.base_url, config.token || null);
          if (config.token && !(await performHandshake(config.base_url, config.token))) {
            return false; // Port is open but the engine is still starting.
          }
          setIsEngineReady(true);
          connected.current();
          return true;
        }
      }
      return false;
    } catch (err) {
      console.warn("Prerequisites check warning:", err);
      return false;
    } finally {
      setIsRecheckingPrereqs(false);
    }
  };

  // Resilient engine startup orchestration with polling, handshake retry, and passive heartbeat
  useEffect(() => {
    let isCancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const MAX_BOOT_ATTEMPTS = 20; // 20 attempts * 1500ms = 30 seconds

    const pollEngineLifecycle = async () => {
      try {
        const prereqs = await invoke<SystemPrerequisites>("check_system_prerequisites");
        if (isCancelled) return;
        setPrerequisites(prereqs);

        // 1. If backend is running, retrieve engine config and perform handshake
        if (prereqs.backend.running) {
          const config = await invoke<{ port: number; token: string; base_url: string }>("get_engine_config");
          if (isCancelled) return;

          if (config && config.port > 0) {
            setEngineConfig(config.base_url, config.token || null);
            let handshakeOk = true;
            if (config.token) {
              handshakeOk = await performHandshake(config.base_url, config.token);
            }

            if (!handshakeOk && attempts < MAX_BOOT_ATTEMPTS) {
              // Engine bound port but Uvicorn handshake endpoint is still initializing
              attempts++;
              return;
            }

            // Connection established successfully!
            if (pollInterval) clearInterval(pollInterval);
            setIsEngineReady(true);

            // Hydrate persistent settings and initial photos
            connected.current();

            apiFetch("/api/system/settings")
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.settings) {
                  if (data.settings.theme) setTheme(data.settings.theme);
                  if (data.settings.grid_density) setGridDensity(data.settings.grid_density);
                  if (data.settings.reduce_motion !== undefined) {
                    document.documentElement.setAttribute("data-reduce-motion", String(data.settings.reduce_motion));
                  }
                }
              })
              .catch(() => {});

            // Switch to lightweight passive heartbeat (every 15s)
            pollInterval = setInterval(async () => {
              try {
                const health = await invoke<SystemPrerequisites>("check_system_prerequisites");
                if (!isCancelled) setPrerequisites(health);
              } catch {}
            }, 15000);

            return;
          }
        }

        // 2. If engine not yet running on first check, ensure background auto-start was kicked off
        if (prereqs.python.installed && !prereqs.backend.running && attempts === 0) {
          invoke("start_backend_engine").catch(() => {});
        }

        // 3. Early halt on fatal blocker (missing VC++ runtime or premature child exit)
        if (!prereqs.vcredist.installed || prereqs.error_message) {
          if (pollInterval) clearInterval(pollInterval);
          return;
        }

        attempts++;
        if (attempts >= MAX_BOOT_ATTEMPTS) {
          if (pollInterval) clearInterval(pollInterval);
          console.warn("Engine connection polling timed out after 30 seconds.");
        }
      } catch (err) {
        // Fallback for standard non-Tauri / browser dev environments
        console.info("Running in standard non-Tauri mode:", err);
        setIsEngineReady(true);
        if (pollInterval) clearInterval(pollInterval);
        connected.current();
      }
    };

    pollEngineLifecycle();
    pollInterval = setInterval(pollEngineLifecycle, 1500);

    return () => {
      isCancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return { isRecheckingPrereqs, startEngine, recheckPrerequisites };
}
