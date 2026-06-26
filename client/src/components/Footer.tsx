import React from 'react';
import PhoneLinks from './PhoneLinks';

export default function Footer() {
  return (
    <footer className="ifcdc-footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>Contact Us</h4>
          <PhoneLinks />
        </div>
        <div className="footer-section">
          <h4>Imperial Foundation CDC</h4>
          <p>Empowering communities through service and development.</p>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Imperial Foundation Community Development Center. All rights reserved.</p>
      </div>
    </footer>
  );
}
