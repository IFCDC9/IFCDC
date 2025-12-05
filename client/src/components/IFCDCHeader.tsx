import React from "react";

export default function IFCDCHeader() {
  return (
    <header className="ifcdc-header" data-testid="header-ifcdc">
      <div className="logo-container">
        <a href="/">
          <img src="/assets/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-logo" />
        </a>
      </div>

      <nav className="ifcdc-nav">
        <a href="/login.html" className="nav-link" data-testid="link-home">Home</a>
        <a href="/radio.html" className="nav-link" data-testid="link-radio">Radio</a>
        <a href="/barber.html" className="nav-link" data-testid="link-barbers">Barbers</a>
        <a href="/client.html" className="nav-link" data-testid="link-community">Community</a>

        <div className="nav-auth">
          <a href="/login.html" className="nav-button gold-3d" data-testid="link-login">Login</a>
          <a href="/register.html" className="nav-button gold-3d" data-testid="link-register">Register</a>
        </div>
      </nav>
    </header>
  );
}
