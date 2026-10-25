"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  cloudConfigurationError,
  cloudAvailable,
  deviceMode,
  deviceModeKey,
  cloudEnabled,
  supabase,
} from "@/lib/cloud-client";

export default function CloudAccount({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setChecking(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  function switchStorage(mode: "local" | "cloud") {
    try {
      window.localStorage.setItem(deviceModeKey, mode);
      window.location.reload();
    } catch {
      setError(
        "Could not remember your choice. Allow browser storage and try again.",
      );
    }
  }
  async function sendCode() {
    if (!supabase || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const address = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      setSentEmail(address);
      setCode("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send the email code.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function verify() {
    if (!supabase || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: sentEmail,
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify this code.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    if (!supabase || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setUser(null);
      setSentEmail("");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (checking)
    return (
      <main className="cloud-login">
        <p role="status">Opening Bouldero…</p>
      </main>
    );
  if (cloudConfigurationError && !deviceMode)
    return (
      <main className="cloud-login">
        <h1>Cloud setup needs attention</h1>
        <p role="alert">{cloudConfigurationError}</p>
        <button className="button" onClick={() => switchStorage("local")}>
          Use on this device without signing in
        </button>
      </main>
    );
  if (!cloudEnabled)
    return (
      <>
        {cloudAvailable && (
          <div className="cloud-account-bar">
            <span>On this device · not synced</span>
            <button onClick={() => switchStorage("cloud")}>
              Email sign-in / cloud
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {children}
      </>
    );
  if (user && !user.is_anonymous)
    return (
      <>
        <div className="cloud-account-bar">
          <span>{user.email}</span>
          <span>Private cloud</span>
          <button disabled={busy} onClick={() => switchStorage("local")}>
            Use on this device
          </button>
          <button disabled={busy} onClick={signOut}>
            Sign out
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div key={user.id}>{children}</div>
      </>
    );
  return (
    <main className="cloud-login">
      <p className="mini-label">BOULDERO · YOUR ACCOUNT</p>
      <h1>Your climbing, on every device.</h1>
      <p>
        Use the same email on your phone and computer. Your lines and sessions
        stay private.
      </p>
      <div className="device-entry">
        <button
          className="button"
          disabled={busy}
          onClick={() => switchStorage("local")}
        >
          Use on this device without signing in
        </button>
        <p>Saved in this browser. Use email sign-in for sync across devices.</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {user?.is_anonymous ? (
        <>
          <p>
            This browser has an older anonymous workspace. Export its data from
            the old version before switching to an email account; it is not
            automatically merged.
          </p>
          <button disabled={busy} onClick={signOut}>
            Continue with email
          </button>
        </>
      ) : !sentEmail ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode();
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Sending…" : "Send sign-in code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <p role="status">
            Check {sentEmail} for your code. A sign-in link also works if the
            email template still uses links.
          </p>
          <label>
            Email code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6,8}"
              maxLength={8}
              value={code}
              disabled={busy}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSentEmail("");
              setCode("");
              setError("");
            }}
          >
            Change email or resend
          </button>
        </form>
      )}
    </main>
  );
}
