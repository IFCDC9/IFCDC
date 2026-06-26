import React from 'react';

const phoneLines = [
  {
    label: 'Community / HQ Line',
    display: '+1 (301) 867-7466',
    tel: '+13018677466',
  },
  {
    label: 'Radio Line',
    display: '+1 (858) 758-8791',
    tel: '+18587588791',
  },
  {
    label: 'Barbershop Line',
    display: '+1 (331) 316-8167',
    tel: '+13313168167',
  },
  {
    label: 'IFCDC Business Line',
    display: '+1 (732) 743-5048',
    tel: '+17327435048',
  },
];

export default function PhoneLinks() {
  return (
    <div className="phone-links">
      {phoneLines.map(line => (
        <div key={line.tel} className="phone-line">
          <span>{line.label}: </span>
          <a href={`tel:${line.tel}`} className="phone-link">
            {line.display}
          </a>
        </div>
      ))}
    </div>
  );
}
