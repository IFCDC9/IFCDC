import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { buildFounderSessionFromLogin, isFounderRole } from "../auth/founderSession";
import { saveDashboardModeLocal } from "../config/executiveWidgets";
import { fetchWithTimeout } from "../api/safeFetch";

const LoginPage = () => {
  const { user, loading, applySessionUser } = useAuth();
  const navigate = useNavigate();
  const redirected = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    if (redirected.current || loading || !user) return;
    redirected.current = true;
    navigate(user.defaultRoute && user.defaultRoute !== "/login" ? user.defaultRoute : "/hq", { replace: true });
  }, [loading, user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password: password.trim(), totpCode: totpCode.trim() || undefined }),
      });

      const data = await res.json();

      if (data.requires2FA) {
        setRequires2FA(true);
        setSubmitting(false);
        setMessage({ type: "", text: data.message || "Enter your authenticator code to continue." });
        return;
      }

      if (!res.ok) {
        setSubmitting(false);
        if (data.requiresMfaSetup) {
          setMessage({ type: "error", text: data.message || "Enable 2FA in Security Center after signing in." });
          return;
        }
        setMessage({ type: "error", text: data.error || data.message || "Login failed" });
        return;
      }

      if (data.mfaSetupRequired) {
        setMessage({ type: "", text: "Sign-in successful. Enable two-factor authentication in Security Center to complete hardening." });
      } else {
        setMessage({ type: "success", text: "Welcome to Headquarters. Redirecting…" });
      }
      saveDashboardModeLocal("standard");

      const role = data.role ?? data.user?.role;
      let sessionUser = null;

      try {
        const sessionRes = await fetchWithTimeout("/api/hq/auth/session", { credentials: "include" }, 8000);
        if (sessionRes.ok) {
          const session = await sessionRes.json();
          sessionUser = session.user ?? null;
        }
      } catch {
        // fall through to founder bootstrap below
      }

      if (!sessionUser && isFounderRole(role)) {
        sessionUser = buildFounderSessionFromLogin(data);
      }

      if (sessionUser) {
        applySessionUser(sessionUser);
        navigate(data.mfaSetupRequired ? "/hq/security" : (sessionUser.defaultRoute || "/hq"), { replace: true });
        return;
      }

      setSubmitting(false);
      if (role === "barber") {
        navigate("/barber", { replace: true });
      } else if (role === "radio_host" || role === "radio") {
        navigate("/radio", { replace: true });
      } else if (role === "program_staff") {
        navigate("/hq/programs", { replace: true });
      } else {
        setMessage({ type: "error", text: "Logged in but Headquarters session unavailable. Try again." });
      }
    } catch {
      setSubmitting(false);
      setMessage({ type: "error", text: "Network error. Try again." });
    }
  };

  return (
    <div className="hq-login-shell">
      <div className="hq-login-bg" aria-hidden="true" />
      <div className="hq-login-card hq-fade-in">
        <div className="hq-login-brand">
          <div className="hq-login-logo">IFCDC</div>
          <div className="hq-login-tagline">Headquarters</div>
          <p className="hq-login-subtitle">Enterprise Operating System</p>
        </div>

        {message.text && (
          <p className={message.type === "error" ? "hq-login-error" : "hq-login-success"} data-testid="message-login">
            {message.text}
          </p>
        )}

        <form id="login-form" className="hq-login-form" onSubmit={handleSubmit}>
          <label className="hq-field">
            <span>Email</span>
            <input
              id="email"
              name="email"
              type="email"
              className="hq-input"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="service@ifcdc.org"
              data-testid="input-email"
            />
          </label>

          <label className="hq-field">
            <span>Password</span>
            <input
              id="password"
              name="password"
              type="password"
              className="hq-input"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-password"
            />
          </label>

          {requires2FA && (
            <label className="hq-field">
              <span>Authenticator Code</span>
              <input
                id="totp"
                name="totp"
                type="text"
                className="hq-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
                data-testid="input-totp"
              />
            </label>
          )}

          <button type="submit" className="hq-btn hq-btn-primary hq-login-submit" disabled={submitting} data-testid="button-submit">
            {submitting ? "Signing in…" : "Enter Headquarters"}
          </button>
        </form>

        <div className="hq-login-footer">
          Don&apos;t have an account? <a href="/register">Register</a>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
