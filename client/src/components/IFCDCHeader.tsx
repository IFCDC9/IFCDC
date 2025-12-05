import React from "react";

export default function IFCDCHeader() {
  return (
    <header className="ifcdc-header" data-testid="header-ifcdc">
      <div className="logo-container">
        <img src="/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-logo" />
      </div>

      <nav className="ifcdc-nav">
        <a href="/login" className="nav-button gold-3d" data-testid="link-login">Login</a>
        <a href="/register" className="nav-button gold-3d" data-testid="link-register">Register</a>
      </nav>
    </header>
  );
}
