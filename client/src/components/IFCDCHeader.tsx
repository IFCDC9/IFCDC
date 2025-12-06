import React from "react";
import { Link } from "react-router-dom";

const Header: React.FC = () => {
  return (
    <header className="ifcdc-header" data-testid="header-ifcdc">
      <div className="ifcdc-header-inner">
        <div className="ifcdc-logo">
          <Link to="/">
            <span className="ifcdc-logo-text">IFCDC</span>
          </Link>
        </div>

        <nav className="ifcdc-nav">
          <Link to="/login" className="ifcdc-link" data-testid="link-login">
            Login
          </Link>
          <Link to="/register" className="ifcdc-link ifcdc-link-primary" data-testid="link-register">
            Register
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default Header;
