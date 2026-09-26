# 🛡️ Architectural Implementation Plan: Dynamic Port Allocation & Zero-Trust Local IPC Authentication

> **Target Version**: v0.2.0  
> **Status**: Approved for Planning  
> **Branch**: `feature/architecture-and-standards`  
> **Author**: Antigravity & Sumit Kanchan  
> **Document Date**: September 27, 2026  

---

## 1. Executive Summary & Problem Breakdown

SecurePhotos operates as an offline, local-first desktop application consisting of a **Tauri 2.0 (Rust/WebView2) frontend** and an **embedded FastAPI Python sidecar engine**. Two critical architectural gaps have been identified that affect reliability and zero-trust security:

### Gap A: Hardcoded Port Collision (`127.0.0.1:8000`)
1. **Port Hijacking & Cross-Instance Pollution**: Port `8000` is statically probed on startup. If another service (or an active development server from another workspace) is running on port `8000`, the production desktop client connects to the foreign process instead of spawning its own isolated engine.
2. **Launch Crashes (`EADDRINUSE`)**: If port `8000` is bound by a foreign process that is not SecurePhotos, or if two instances of SecurePhotos are opened simultaneously, `uvicorn` throws `[Errno 10048] address already in use` and crashes.
3. **Hardcoded Frontend Endpoints**: Multiple React components currently contain hardcoded strings pointing directly to `http://127.0.0.1:8000/api/...`, preventing dynamic port flexibility.

### Gap B: Unauthenticated Local HTTP Endpoints (Local Privilege Escalation / Data Snooping)
1. **CORS Is Not Authorization**: The FastAPI engine currently relies solely on browser `CORSMiddleware`. However, CORS is **strictly enforced by web browsers**. Any non-browser process running on the user's computer (e.g., local scripts, background services, malicious utilities, or `curl`/PowerShell commands) can send unauthenticated HTTP requests to `http://127.0.0.1:8000`.
2. **Private Vault Exposure**: When the private vault is unlocked, decrypted streams (`/api/vault/stream/{id}`) and metadata endpoints become queryable by any unauthorized local process without needing the Master Vault Key (MVK), PIN, or password.

---

## 2. Root Cause Analysis

| Problem | Root Cause in Codebase |
| :--- | :--- |
| **Port 8000 Collision** | `src-tauri/src/lib.rs` executes `TcpStream::connect_timeout("127.0.0.1:8000")` and terminates sidecar boot if anything answers. |
| **Static Endpoint Coupling** | Frontend components (`Lightbox.tsx`, `StoryPlayerModal.tsx`, `VideoOptimizerView.tsx`, `Sidebar.tsx`) use static `http://127.0.0.1:8000/api/...` URLs instead of dynamic config. |
| **Unauthenticated Sidecar API** | `engine/main.py` does not inspect request tokens or session cookies; it serves all HTTP requests unconditionally to any process connecting to `127.0.0.1`. |

---

## 3. High-Level Architecture: The Dynamic IPC Handshake

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BOOTSTRAP SEQUENCE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Rust Startup:                                                            │
│    • Binds TcpListener to 127.0.0.1:0 -> OS assigns free ephemeral port    │
│      (e.g., port 54129). Drops temporary listener.                         │
│    • Generates cryptographically secure 256-bit random hex token (token_a).│
│                                                                             │
│ 2. Sidecar Launch:                                                          │
│    • Spawns securephotos-engine.exe with arguments:                         │
│      --port 54129 --data-dir <app_data>                                     │
│    • Injects environment variable strictly into child process:              │
│      SECUREPHOTOS_IPC_SECRET=<token_a>                                      │
│                                                                             │
│ 3. Frontend Handshake (Tauri IPC):                                          │
│    • React frontend calls native Tauri command invoke("get_engine_config")   │
│    • Rust returns: { port: 54129, token: "<token_a>", baseUrl: "..." }      │
│    • React stores this dynamically in memory in useAppStore.                │
│                                                                             │
│ 4. Zero-Trust Security Middleware in FastAPI:                               │
│    • Global middleware intercepts all incoming requests to /api/*.          │
│    • Validates presence of:                                                 │
│        a) Header: X-SecurePhotos-Token: <token_a>, OR                       │
│        b) Cookie: securephotos_ipc=<token_a> (HttpOnly; SameSite=Strict)    │
│    • If token is missing/invalid: returns 403 Forbidden immediately.         │
│    • Initial /api/auth/handshake endpoint exchanges header for session      │
│      cookie to seamlessly authenticate browser <img> and <video> tags.      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component-by-Component Implementation Specification

### Component 1: Rust Client (`src-tauri/src/lib.rs` & `src-tauri/Cargo.toml`)
* **Ephemeral Port Selection**:
  ```rust
  fn find_available_port() -> u16 {
      std::net::TcpListener::bind("127.0.0.1:0")
          .and_then(|listener| listener.local_addr())
          .map(|addr| addr.port())
          .unwrap_or(8000)
  }
  ```
* **Cryptographic Token Generation**:
  * Use `rand::RngCore` or `uuid::Uuid::new_v4()` to generate a 32-byte hex string.
  * Store `active_port` and `ipc_token` in Tauri state:
    ```rust
    pub struct AppEngineState {
        pub port: std::sync::atomic::AtomicU16,
        pub token: std::sync::RwLock<String>,
    }
    ```
* **Sidecar Process Environment Isolation**:
  * When spawning `Command::new(&sidecar_path)`, set:
    ```rust
    cmd.env("SECUREPHOTOS_IPC_SECRET", &token);
    cmd.args(["--port", &port.to_string(), "--data-dir", data_dir.to_str().unwrap()]);
    ```
* **Expose Tauri IPC Command**:
  ```rust
  #[tauri::command]
  fn get_engine_config(state: tauri::State<AppEngineState>) -> EngineConfigDto {
      EngineConfigDto {
          port: state.port.load(std::sync::atomic::Ordering::SeqCst),
          token: state.token.read().unwrap().clone(),
          base_url: format!("http://127.0.0.1:{}", state.port.load(std::sync::atomic::Ordering::SeqCst)),
      }
  }
  ```

---

### Component 2: FastAPI Backend (`engine/config.py` & `engine/main.py`)
* **Configuration Expansion (`engine/config.py`)**:
  ```python
  class AppConfig(BaseSettings):
      ...
      ipc_secret: Optional[str] = Field(
          default=None,
          alias="SECUREPHOTOS_IPC_SECRET",
          description="Cryptographic shared secret for local IPC authorization"
      )
  ```
* **Security Middleware (`engine/middleware/auth_middleware.py`)**:
  ```python
  from starlette.middleware.base import BaseHTTPMiddleware
  from starlette.responses import JSONResponse

  class LocalIPCSecurityMiddleware(BaseHTTPMiddleware):
      async def dispatch(self, request, call_next):
          # 1. Allow health check probe without credentials for fast startup polling
          if request.url.path in ("/health", "/api/health"):
              return await call_next(request)

          # 2. In local dev mode without SECUREPHOTOS_IPC_SECRET set, allow open loopback
          if not settings.ipc_secret:
              return await call_next(request)

          # 3. Check for X-SecurePhotos-Token header
          auth_header = request.headers.get("X-SecurePhotos-Token")
          if auth_header and hmac.compare_digest(auth_header, settings.ipc_secret):
              return await call_next(request)

          # 4. Check for secure session cookie (for <img> and <video> tags)
          auth_cookie = request.cookies.get("securephotos_ipc")
          if auth_cookie and hmac.compare_digest(auth_cookie, settings.ipc_secret):
              return await call_next(request)

          # 5. Check for short-lived query param for streaming tags (?token=...)
          query_token = request.query_params.get("token")
          if query_token and hmac.compare_digest(query_token, settings.ipc_secret):
              return await call_next(request)

          return JSONResponse(
              status_code=403,
              content={"detail": "Unauthorized local IPC access. Valid token or session required."},
          )
  ```
* **Handshake Route (`engine/api/auth.py`)**:
  * Endpoint: `POST /api/auth/handshake`
  * Validates `X-SecurePhotos-Token` header.
  * Returns response setting cookie:
    `Set-Cookie: securephotos_ipc=<token>; HttpOnly; SameSite=Strict; Path=/api/`
  * This allows all native `<img src="...">` and `<video src="...">` elements to stream media automatically without breaking or leaking tokens in URLs.

---

### Component 3: Frontend Dynamic URL & Interceptor Centralization (`src/`)
* **State Management (`src/store/useAppStore.ts`)**:
  * Add state:
    ```typescript
    apiBaseUrl: string;
    apiToken: string | null;
    setEngineConfig: (baseUrl: string, token: string) => void;
    ```
* **Central API Helper (`src/services/api.ts`)**:
  * Create unified request wrapper `apiFetch()`:
    ```typescript
    export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const { apiBaseUrl, apiToken } = useAppStore.getState();
        const url = `${apiBaseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
        
        const headers = new Headers(options.headers || {});
        if (apiToken) {
            headers.set("X-SecurePhotos-Token", apiToken);
        }
        return fetch(url, { ...options, headers });
    }
    ```
* **Media URL Generator (`src/utils/mediaUrl.ts`)**:
  * Export `getPhotoUrl(photoId, type)` and `getVideoStreamUrl(videoId)`:
    ```typescript
    export function getMediaUrl(path: string): string {
        const { apiBaseUrl } = useAppStore.getState();
        return `${apiBaseUrl}${path}`;
    }
    ```
* **Replace All Hardcoded `http://127.0.0.1:8000` Occurrences**:
  * `src/components/Lightbox.tsx`
  * `src/components/StoryPlayerModal.tsx`
  * `src/components/VideoOptimizerView.tsx`
  * `src/components/Sidebar.tsx`
  * `src/components/PhotoGrid.tsx`
  * `src/components/AlbumsView.tsx`
  * `src/components/PeopleView.tsx`

---

## 5. Development Mode vs. Production Mode Matrix

| Environment | Dynamic Port Behavior | Authentication Behavior |
| :--- | :--- | :--- |
| **Development (`npm run dev` / Vite / `.venv`)** | Defaults to port `8000` (or `VITE_API_URL`) if launched outside Tauri, but uses `get_engine_config` when inside Tauri. | If `SECUREPHOTOS_IPC_SECRET` is unset in `.env`, authentication middleware operates in transparent bypass mode so developer curl/Swagger docs work. |
| **Production Release (`securephotos.exe`)** | Uses OS ephemeral port (e.g. `53412`) allocated by Rust. | **Strictly Enforced**: All requests without the 256-bit token or session cookie are blocked with 403 Forbidden. |

---

## 6. Edge Cases & Risk Mitigation

1. **WebView2 Media Cookie Partitioning**:
   * *Risk*: Modern browser engines can block cookies on loopback or cross-origin URLs.
   * *Mitigation*: The cookie is issued directly from `http://127.0.0.1:<port>` with `Path=/api/` and `SameSite=Strict`. Since both API calls and image tags point to the exact same host and port, WebView2 natively transmits the cookie on all media requests. Additionally, a fallback query param `?token=` is accepted for isolated video element sources if required.
2. **Timing of Port Handshake on App Launch**:
   * *Risk*: The frontend attempts to render photos before Tauri's `get_engine_config` IPC command resolves.
   * *Mitigation*: The root `App.tsx` already features a loading/initialization gate (`isEngineReady`). The handshake will resolve during this gate before rendering the photo grid.
3. **Engine Crash & Re-spawn with Port Drift**:
   * *Risk*: If the engine sidecar terminates and restarts, its port might change.
   * *Mitigation*: `relaunch_app` in Rust already manages clean process termination and re-binds safely.

---

## 7. Step-by-Step Verification Checklist

- [ ] **Step 1**: Run backend unit tests (`pytest engine/tests/`) verifying token verification passes with valid headers and returns 403 with invalid/missing headers.
- [ ] **Step 2**: Launch two distinct instances of `securephotos.exe` simultaneously; verify they bind to separate ephemeral ports without collisions or shared database locks.
- [ ] **Step 3**: Attempt an unauthenticated curl command (`curl http://127.0.0.1:<port>/api/photos`); verify it is rejected with `403 Forbidden`.
- [ ] **Step 4**: Verify all photos, thumbnails, and 200% boosted videos render cleanly inside the desktop app with the active token/cookie.
- [ ] **Step 5**: Update `docs/features_and_functional_decisions.md` (Section 85) and push all code changes to origin.
