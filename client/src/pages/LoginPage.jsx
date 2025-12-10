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
            className="replit-auth-button"
            data-testid="button-replit-login"
          >
            <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor">
              <path d="M7 5.5C7 4.67157 7.67157 4 8.5 4H15.5C16.3284 4 17 4.67157 17 5.5V12H8.5C7.67157 12 7 11.3284 7 10.5V5.5Z"/>
              <path d="M17 12H25.5C26.3284 12 27 12.6716 27 13.5V18.5C27 19.3284 26.3284 20 25.5 20H17V12Z"/>
              <path d="M7 21.5C7 20.6716 7.67157 20 8.5 20H17V26.5C17 27.3284 16.3284 28 15.5 28H8.5C7.67157 28 7 27.3284 7 26.5V21.5Z"/>
            </svg>
            Continue with Replit
          </a>

          <div className="auth-divider">
            <span>or sign in with email</span>
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
