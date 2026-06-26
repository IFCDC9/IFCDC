import React, { useState } from "react";
import Header from "../components/IFCDCHeader";

const RegisterPage = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("client");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          role,
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Registration failed" });
        return;
      }

      setMessage({ type: "success", text: "Account created. Redirecting to login…" });
      setTimeout(() => {
        window.location.href = "/login";
      }, 1000);
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
          <h1 className="auth-title">Create an Account</h1>
          <p className="auth-subtitle">
            Register once and plug into IFCDC Barbers, Radio, and Community programs.
          </p>

          {message.text && (
            <p className={message.type === "error" ? "auth-error" : "auth-success"} data-testid="message-register">
              {message.text}
            </p>
          )}

          <form id="register-form" onSubmit={handleSubmit}>
            <div className="auth-form-group">
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-name"
              />
            </div>

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
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="role">Role</label>
              <select
                id="role"
                name="role"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                data-testid="select-role"
              >
                <option value="client">Client / Community</option>
                <option value="barber">Barber</option>
                <option value="radio">Radio Ops</option>
                <option value="admin">Admin (IFCDC Internal)</option>
              </select>
            </div>

            <button type="submit" className="nav-button gold-3d auth-submit" disabled={loading} data-testid="button-submit">
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account?{" "}
            <a href="/login">Login here</a>
          </div>
        </section>
      </main>
    </>
  );
};

export default RegisterPage;
