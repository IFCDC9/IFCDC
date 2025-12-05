import React from "react";
import { Link } from "react-router-dom";

export default function IFCDCHeader() {
  return (
    <header className="header" data-testid="header-ifcdc">
      <div className="logo-container">
        <Link to="/">
          <img src="/assets/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-logo" />
        </Link>
      </div>

      <div className="nav-actions">
        <Link to="/login" className="gold-link" data-testid="link-login">Login</Link>
        <Link to="/register" className="gold-link" data-testid="link-register">Register</Link>
      </div>
    </header>
  );
}
