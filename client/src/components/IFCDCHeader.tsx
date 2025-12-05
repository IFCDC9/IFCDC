import React from "react";

export default function IFCDCHeader() {
  return (
    <header className="top-bar" data-testid="header-ifcdc">
      <div className="logo-area">
        <a href="/">
          <img src="/assets/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-logo" />
        </a>
      </div>

      <nav className="top-nav">
        <a href="/" className="nav-link" data-testid="link-home">Home</a>
        <a href="/barbershop" className="nav-link" data-testid="link-barbershop">Barbershop</a>
        <a href="/radio" className="nav-link" data-testid="link-radio">Radio</a>
        <a href="/community" className="nav-link" data-testid="link-community">Community</a>

        <div className="auth-actions">
          <a href="/login" className="nav-link nav-link-gold" data-testid="link-login">Login</a>
          <a href="/register" className="nav-link nav-link-gold nav-link-outline" data-testid="link-register">Register</a>
        </div>
      </nav>
    </header>
  );
}
