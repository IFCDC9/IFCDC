import { useState } from 'react';
import FormRenderer from '../components/FormRenderer';

const SAMPLE_FORMS = [
  {
    id: 1,
    title: 'Time Off Request',
    description: 'Submit a request for vacation, sick leave, or personal time.',
    fields: [
      { name: 'startDate', label: 'Start Date', type: 'text' },
      { name: 'endDate', label: 'End Date', type: 'text' },
      { name: 'type', label: 'Leave Type', type: 'select', options: ['Vacation', 'Sick Leave', 'Personal'] },
      { name: 'reason', label: 'Reason', type: 'textarea' },
    ],
  },
  {
    id: 2,
    title: 'Incident Report',
    description: 'Report a workplace incident or safety concern.',
    fields: [
      { name: 'date', label: 'Date of Incident', type: 'text' },
      { name: 'location', label: 'Location', type: 'text' },
      { name: 'description', label: 'Description of Incident', type: 'textarea' },
      { name: 'witnesses', label: 'Witnesses (if any)', type: 'text' },
    ],
  },
  {
    id: 3,
    title: 'Equipment Request',
    description: 'Request new equipment or supplies for your department.',
    fields: [
      { name: 'item', label: 'Item Requested', type: 'text' },
      { name: 'quantity', label: 'Quantity', type: 'text' },
      { name: 'urgency', label: 'Urgency', type: 'select', options: ['Low', 'Medium', 'High'] },
      { name: 'justification', label: 'Justification', type: 'textarea' },
    ],
  },
];

export default function FormsPage() {
  const [selectedForm, setSelectedForm] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (values) => {
    console.log('Form submitted:', values);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="forms-page">
      <div className="forms-sidebar">
        <h2>Available Forms</h2>
        <ul>
          {SAMPLE_FORMS.map(form => (
            <li key={form.id}>
              <button
                className={selectedForm?.id === form.id ? 'active-form' : ''}
                onClick={() => { setSelectedForm(form); setSubmitted(false); }}
              >
                {form.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="forms-content">
        <FormRenderer formDef={selectedForm} onSubmit={handleSubmit} />
        {submitted && <div className="form-success">Form submitted successfully!</div>}
      </div>
    </div>
  );
}
