import { useState } from 'react';
import FormRenderer from '../components/FormRenderer';

const SAMPLE_FORMS = [
  {
    slug: 'time-off-request',
    title: 'Time Off Request',
    description: 'Submit a request for vacation, sick leave, or personal time.',
    version: 1,
    fields: [
      { name: 'startDate', label: 'Start Date', type: 'date', required: true },
      { name: 'endDate', label: 'End Date', type: 'date', required: true },
      { 
        name: 'leaveType', 
        label: 'Leave Type', 
        type: 'select', 
        required: true,
        options: [
          { value: 'vacation', label: 'Vacation' },
          { value: 'sick', label: 'Sick Leave' },
          { value: 'personal', label: 'Personal Day' },
          { value: 'bereavement', label: 'Bereavement' },
        ]
      },
      { name: 'reason', label: 'Reason', type: 'textarea', required: false, helpText: 'Optional - provide details if needed' },
      { name: 'emergencyContact', label: 'Emergency Contact', type: 'tel', placeholder: '(555) 123-4567' },
    ],
  },
  {
    slug: 'incident-report',
    title: 'Incident Report',
    description: 'Report a workplace incident or safety concern.',
    version: 2,
    fields: [
      { name: 'incidentDate', label: 'Date of Incident', type: 'date', required: true },
      { name: 'incidentTime', label: 'Time of Incident', type: 'time', required: true },
      { name: 'location', label: 'Location', type: 'text', required: true, placeholder: 'Building, room, or area' },
      { 
        name: 'severity', 
        label: 'Severity Level', 
        type: 'radio', 
        required: true,
        options: [
          { value: 'low', label: 'Low - No injury, minor issue' },
          { value: 'medium', label: 'Medium - Minor injury or potential hazard' },
          { value: 'high', label: 'High - Serious injury or major safety concern' },
        ]
      },
      { name: 'description', label: 'Description of Incident', type: 'textarea', required: true, maxLength: 1000 },
      { name: 'witnesses', label: 'Witnesses', type: 'text', helpText: 'Names of any witnesses, separated by commas' },
      { name: 'medicalAttention', label: 'Medical attention was required', type: 'checkbox' },
    ],
  },
  {
    slug: 'equipment-request',
    title: 'Equipment Request',
    description: 'Request new equipment or supplies for your department.',
    version: 1,
    fields: [
      { name: 'itemName', label: 'Item Requested', type: 'text', required: true },
      { name: 'quantity', label: 'Quantity', type: 'number', required: true, placeholder: '1' },
      { 
        name: 'urgency', 
        label: 'Urgency', 
        type: 'select',
        required: true,
        options: [
          { value: 'low', label: 'Low - Within 30 days' },
          { value: 'medium', label: 'Medium - Within 2 weeks' },
          { value: 'high', label: 'High - Within 1 week' },
          { value: 'critical', label: 'Critical - Immediate need' },
        ]
      },
      { 
        name: 'categories', 
        label: 'Categories', 
        type: 'multiselect',
        helpText: 'Select all that apply',
        options: [
          { value: 'office', label: 'Office Supplies' },
          { value: 'tech', label: 'Technology' },
          { value: 'furniture', label: 'Furniture' },
          { value: 'safety', label: 'Safety Equipment' },
        ]
      },
      { name: 'justification', label: 'Business Justification', type: 'textarea', required: true },
      { name: 'supervisorEmail', label: 'Supervisor Email', type: 'email', required: true },
    ],
  },
  {
    slug: 'training-feedback',
    title: 'Training Feedback',
    description: 'Provide feedback on a training session you attended.',
    version: 1,
    fields: [
      { name: 'trainingName', label: 'Training Name', type: 'text', required: true },
      { name: 'trainingDate', label: 'Date Attended', type: 'date', required: true },
      { 
        name: 'rating', 
        label: 'Overall Rating', 
        type: 'radio',
        required: true,
        options: [
          { value: '5', label: 'Excellent' },
          { value: '4', label: 'Good' },
          { value: '3', label: 'Average' },
          { value: '2', label: 'Below Average' },
          { value: '1', label: 'Poor' },
        ]
      },
      { name: 'feedback', label: 'Comments', type: 'textarea', placeholder: 'What did you like? What could be improved?' },
      { name: 'recommendToOthers', label: 'I would recommend this training to others', type: 'checkbox' },
    ],
  },
];

export default function FormsPage() {
  const [selectedForm, setSelectedForm] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (values) => {
    console.log('Form submitted:', selectedForm?.slug, values);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="forms-page">
      <div className="forms-sidebar">
        <h2>Available Forms</h2>
        <ul>
          {SAMPLE_FORMS.map(form => (
            <li key={form.slug}>
              <button
                className={selectedForm?.slug === form.slug ? 'active-form' : ''}
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
