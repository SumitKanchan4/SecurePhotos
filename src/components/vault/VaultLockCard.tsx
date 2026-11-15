/**
 * The locked vault (redesign R4; Q5: moved out of VaultView.tsx unchanged): one card with the
 * 4-digit PIN (after a lock in this session) or the master password, the password hint when
 * asked for, and the Emergency Card link. Unlocking happens here; the vault screen reacts to
 * the store's isVaultUnlocked.
 */
import React, { useEffect, useRef, useState } from "react";
import { CreditCard, Eye, EyeOff, Loader2, Lock, ShieldAlert, Unlock } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";

interface VaultLockCardProps {
  /** Ask for the master password even when the PIN could be used (after a password reset). */
  startWithPassword?: boolean;
  showHint: boolean;
  onForgotPassword: () => void;
}

export const VaultLockCard: React.FC<VaultLockCardProps> = ({ startWithPassword = false, showHint, onForgotPassword }) => {
  const { setIsVaultUnlocked, vaultPasswordHint, hasVaultPin, isVaultPinLocked, checkVaultStatus, showToast } = useAppStore();
  const [authMode, setAuthMode] = useState<"pin" | "password">("password");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // PIN after a lock in this session; the master password otherwise (or after a reset).
  useEffect(() => {
    if (hasVaultPin && !isVaultPinLocked && !startWithPassword) {
      setAuthMode("pin");
    } else {
      setAuthMode("password");
    }
  }, [hasVaultPin, isVaultPinLocked, startWithPassword]);

  // Generic unlock submission
  const performUnlock = async (payload: { password?: string; pin?: string }) => {
    setLoginError("");
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsVaultUnlocked(true);
        setPassword("");
        setPin(["", "", "", ""]);
        await checkVaultStatus();
        showToast("Private Vault unlocked.", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        setLoginError(data.detail || "Authentication failed. Please try again.");
        await checkVaultStatus();
        if (payload.pin) {
          // Clear pin inputs on failure
          setPin(["", "", "", ""]);
          pinInputRefs.current[0]?.focus();
        }
      }
    } catch (err: unknown) {
      console.error("Unlock error:", err);
      setLoginError("Could not connect to authentication service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    performUnlock({ password });
  };

  // PIN change with auto-submit on 4th digit
  const handlePinDigitChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const nextPin = [...pin];
    nextPin[index] = digit;
    setPin(nextPin);

    if (digit && index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all 4 digits are entered
    const completePin = nextPin.join("");
    if (completePin.length === 4) {
      performUnlock({ pin: completePin });
    }
  };

  const handlePinDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="vault-locked">
      <div className="vault-lock-card">
        <div className="vault-lock-emblem">
          <Lock size={26} strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="vault-lock-title">Your vault is locked</h2>
          <p className="vault-lock-sub">
            {authMode === "pin" && !isVaultPinLocked ? "Enter your 4-digit PIN" : "Enter your master password"}
          </p>
        </div>

        {isVaultPinLocked && hasVaultPin && (
          <p className="vault-note">
            <ShieldAlert size={14} />
            <span>Enter your master password. After that, your PIN reopens the vault until you close the app.</span>
          </p>
        )}

        {loginError && (
          <p className="vault-error" role="alert">
            <ShieldAlert size={14} />
            <span>{loginError}</span>
          </p>
        )}

        {showHint && vaultPasswordHint && (
          <p className="vault-note">
            Hint: <strong>{vaultPasswordHint}</strong>
          </p>
        )}

        {authMode === "pin" && !isVaultPinLocked ? (
          <div className="vault-pin" role="group" aria-label="4-digit PIN">
            {[0, 1, 2, 3].map((idx) => (
              <input
                key={`unlock-pin-${idx}`}
                ref={(el) => { pinInputRefs.current[idx] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                aria-label={`PIN digit ${idx + 1}`}
                value={pin[idx]}
                onChange={(e) => handlePinDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handlePinDigitKeyDown(idx, e)}
                autoFocus={idx === 0}
                disabled={isSubmitting}
                className={`vault-pin-box${pin[idx] ? " is-filled" : ""}`}
              />
            ))}
          </div>
        ) : (
          <form onSubmit={handlePasswordSubmit} className="vault-password">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Master Password..."
              aria-label="Master password"
              autoFocus
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="vault-password-eye"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button type="submit" className="vault-unlock-btn" disabled={isSubmitting || !password}>
              {isSubmitting ? <Loader2 size={13} className="spin" /> : <Unlock size={13} />}
              {isSubmitting ? "Opening…" : "Unlock"}
            </button>
          </form>
        )}

        {isSubmitting && authMode === "pin" && (
          <p className="vault-lock-sub">
            <Loader2 size={13} className="spin" /> Checking PIN…
          </p>
        )}

        <div className="vault-lock-links">
          {authMode === "pin" && !isVaultPinLocked ? (
            <button type="button" className="vault-link" onClick={() => { setAuthMode("password"); setLoginError(""); }}>
              Use master password instead
            </button>
          ) : hasVaultPin && !isVaultPinLocked ? (
            <button type="button" className="vault-link" onClick={() => { setAuthMode("pin"); setLoginError(""); }}>
              Use your PIN instead
            </button>
          ) : null}
          <button type="button" className="vault-link vault-link-muted" onClick={onForgotPassword}>
            <CreditCard size={13} /> Forgot your password? Use your Emergency Card
          </button>
        </div>
      </div>
    </div>
  );
};
