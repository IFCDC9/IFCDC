import React from "react";
import { Link } from "react-router-dom";

export default function LoginRegister() {
  return (
    <div className="auth-actions" data-testid="auth-actions">
      <Link to="/login" className="nav-link nav-link-gold" data-testid="link-login">
        Login
      </Link>
      <Link to="/register" className="nav-link nav-link-gold nav-link-outline" data-testid="link-register">
        Register
      </Link>
    </div>
  );
}
