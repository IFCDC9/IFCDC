import React, { useState } from "react";
import IFCDCHeader from "../components/IFCDCHeader";

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

      localStorage.setItem("ifcdc_token", data.token);
      localStorage.setItem("ifcdc_role", data.role);
      setMessage({ type: "success", text: "Login successful. Redirecting…" });

      // Redirect by role
      if (data.role === "admin" || data.role === "exec") {
        window.location.href = "/admin/hr";
      } else if (data.role === "barber") {
        window.location.href = "/barber.html";
      } else if (data.role === "radio") {
        window.location.href = "/radio.html";
      } else {
        window.location.href = "/client.html";
      }
    } catch (err) {
      setLoading(false);
      setMessage({ type: "error", text: "Network error. Try again." });
    }
  };

  return (
    <>
      <IFCDCHeader />

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
            <a href="/register.html">Register now</a>
          </div>
        </section>
      </main>
    </>
  );
};

export default LoginPage;
