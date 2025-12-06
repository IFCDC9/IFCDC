import React from "react";
import { Link } from "react-router-dom";

export default function IFCDCHeader() {
  return (
    <header className="site-header" data-testid="header-ifcdc">
      <div className="branding">
        <Link to="/">
          <img src="/assets/logo-gold-3d.png" alt="IFCDC Logo" className="ifcdc-logo" />
        </Link>
      </div>

      <nav className="nav-actions">
        <Link to="/login" className="nav-link auth-link" data-testid="link-login">Login</Link>
        <Link to="/register" className="nav-link auth-link register" data-testid="link-register">Register</Link>
      </nav>
    </header>
  );
}
