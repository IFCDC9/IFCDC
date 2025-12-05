import React from "react";
import { Link } from "react-router-dom";
import LoginRegister from "./LoginRegister";

export default function IFCDCHeader() {
  return (
    <header className="top-bar" data-testid="header-ifcdc">
      <div className="logo-area">
        <Link to="/">
          <img src="/assets/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-logo" />
        </Link>
      </div>

      <nav className="top-nav">
        <Link to="/" className="nav-link" data-testid="link-home">Home</Link>
        <Link to="/barbershop" className="nav-link" data-testid="link-barbershop">Barbershop</Link>
        <Link to="/radio" className="nav-link" data-testid="link-radio">Radio</Link>
        <Link to="/community" className="nav-link" data-testid="link-community">Community</Link>

        <LoginRegister />
      </nav>
    </header>
  );
}
