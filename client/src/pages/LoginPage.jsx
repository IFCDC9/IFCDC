import React, { useState } from "react";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem("ifcdc_token", data.token);
      localStorage.setItem("ifcdc_role", data.role);
      window.location.href = "/admin/hr";
    } else {
      alert("Invalid login.");
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>IFCDC Admin Login</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: 320, display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          data-testid="input-email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          data-testid="input-password"
        />
        <button type="submit" disabled={loading} data-testid="button-submit">
          {loading ? "Logging in..." : "Log In"}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
