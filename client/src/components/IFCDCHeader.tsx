import React from "react";
import { Link } from "react-router-dom";

export default function IFCDCHeader() {
  return (
    <header className="ifcdc-header" data-testid="header-ifcdc">
      <div className="ifcdc-logo-wrap">
        <Link to="/">
          <img src="/assets/ifcdc-logo.png" alt="IFCDC" className="ifcdc-logo" />
          <span className="ifcdc-brand-text">IFCDC</span>
        </Link>
      </div>

      <nav className="ifcdc-nav-actions">
        <Link to="/login" className="ifcdc-nav-link" data-testid="link-login">Login</Link>
        <Link to="/register" className="ifcdc-nav-link ifcdc-nav-primary" data-testid="link-register">Register</Link>
      </nav>
    </header>
  );
}
