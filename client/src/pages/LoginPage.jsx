import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import Header from "../components/IFCDCHeader";

const LoginPage = () => {
  const { refreshUser } = useAuth();
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
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });

      const data = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Login failed" });
        return;
      }

      setMessage({ type: "success", text: "Login successful. Redirecting…" });

      // Refresh user context then redirect
      await refreshUser();
      
      const role = data.role;
      if (role === "admin") {
        window.location.href = "/admin/dashboard";
      } else if (role === "owner" || role === "EXEC") {
        window.location.href = "/admin";
      } else if (role === "barber") {
        window.location.href = "/barber";
      } else if (role === "radio" || role === "radio_host") {
        window.location.href = "/radio";
      } else {
        window.location.href = "/dashboard";
      }
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
