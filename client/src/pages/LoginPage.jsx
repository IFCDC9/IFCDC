import React, { useState } from "react";
import Header from "../components/IFCDCHeader";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });

      const data = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Login failed" });
        return;
      }

      setMessage({ type: "success", text: "Login successful. Redirecting…" });

      // Redirect by role
      setTimeout(() => {
        if (data.role === "owner" || data.role === "admin" || data.role === "EXEC") {
          window.location.href = "/admin";
        } else if (data.role === "barber") {
          window.location.href = "/barber";
        } else if (data.role === "radio" || data.role === "radio_host") {
          window.location.href = "/radio";
        } else {
          window.location.href = "/";
        }
      }, 500);
    } catch (err) {
      setLoading(false);
      setMessage({ type: "error", text: "Network error. Try again." });
    }
  };

  return (
    <>
      <Header />

      <main>
        <section className="auth-wrapper">
          <h1 className="auth-title">Login</h1>
          <p className="auth-subtitle">Access your IFCDC dashboard with your credentials.</p>

          {message.text && (
            <p className={message.type === "error" ? "auth-error" : "auth-success"} data-testid="message-login">
              {message.text}
            </p>
          )}

          <a 
            href="/api/replit/login" 
            className="sso-button"
            data-testid="button-sso-login"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              padding: "0.875rem 1.5rem",
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              border: "1px solid #d4af37",
              borderRadius: "8px",
              color: "#d4af37",
              textDecoration: "none",
              fontWeight: "600",
              fontSize: "1rem",
              marginBottom: "1.5rem",
              transition: "all 0.3s ease",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            Sign in with Google, GitHub, Apple or X
          </a>

          <div className="auth-divider" style={{ 
            display: "flex", 
            alignItems: "center", 
            margin: "1.5rem 0",
            color: "#666"
          }}>
            <span style={{ flex: 1, height: "1px", background: "#333" }}></span>
            <span style={{ padding: "0 1rem" }}>or sign in with email</span>
            <span style={{ flex: 1, height: "1px", background: "#333" }}></span>
          </div>

          <form id="login-form" onSubmit={handleSubmit}>
            <div className="auth-form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>

            <button type="submit" className="nav-button gold-3d auth-submit" disabled={loading} data-testid="button-submit">
              {loading ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <div className="auth-footer">
            Don't have an account yet?{" "}
            <a href="/register">Register now</a>
          </div>
        </section>
      </main>
    </>
  );
};

export default LoginPage;
