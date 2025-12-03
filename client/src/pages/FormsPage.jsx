import { useState } from 'react';
import FormRenderer from '../components/FormRenderer';

const FORMS = [
  {
    slug: "incident_report",
    title: "Incident Report",
    description: "Use this form to document any significant safety, behavioral, medical, or field incident involving a participant, visitor, or staff member.",
    version: 1,
    fields: [
      {
        name: "incident_date",
        label: "Incident Date",
        type: "date",
        required: true
      },
      {
        name: "incident_time",
        label: "Incident Time",
        type: "time",
        required: true
      },
      {
        name: "location",
        label: "Location of Incident",
        type: "text",
        required: true,
        placeholder: "Program site, street location, school, etc."
      },
      {
        name: "program",
        label: "Program Area",
        type: "select",
        required: true,
        options: [
          { value: "youth_development", label: "Youth Development" },
          { value: "cvi", label: "Community Violence Intervention (CVI)" },
          { value: "workforce", label: "Workforce Development" },
          { value: "barbershop", label: "Barbershop Workforce Pipeline" },
          { value: "family_services", label: "Family Services" },
          { value: "radio_media", label: "IFCDC Radio & Media" },
          { value: "other", label: "Other / General IFCDC" }
        ]
      },
      {
        name: "incident_type",
        label: "Incident Type",
        type: "multiselect",
        required: true,
        options: [
          { value: "physical_altercation", label: "Physical altercation / fight" },
          { value: "verbal_conflict", label: "Verbal conflict / escalation" },
          { value: "threats", label: "Threats / intimidation" },
          { value: "weapons_related", label: "Weapons related concern" },
          { value: "self_harm_concern", label: "Self-harm concern" },
          { value: "medical_emergency", label: "Medical emergency" },
          { value: "property_damage", label: "Property damage" },
          { value: "policy_violation", label: "Policy violation" },
          { value: "safety_concern", label: "General safety concern" },
          { value: "other", label: "Other" }
        ]
      },
      {
        name: "participants_involved",
        label: "Names of Individuals Involved",
        type: "textarea",
        required: true,
        placeholder: "List participants, staff, visitors, etc.",
        maxLength: 500
      },
      {
        name: "incident_summary",
        label: "Incident Summary (Factual Narrative)",
        type: "textarea",
        required: true,
        helpText: "Describe what happened in chronological, factual, non-judgmental language.",
        maxLength: 2000
      },
      {
        name: "immediate_actions_taken",
        label: "Immediate Actions Taken by Staff",
        type: "textarea",
        required: true,
        helpText: "De-escalation steps, first aid, separation, 911 call, etc.",
        maxLength: 1500
      },
      {
        name: "law_enforcement_involved",
        label: "Was Law Enforcement Involved?",
        type: "radio",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" }
        ]
      },
      {
        name: "law_enforcement_details",
        label: "If Yes, Describe Law Enforcement Involvement",
        type: "textarea",
        required: false,
        maxLength: 1000
      },
      {
        name: "injuries",
        label: "Were There Any Injuries?",
        type: "radio",
        required: true,
        options: [
          { value: "none", label: "No injuries reported" },
          { value: "minor", label: "Minor injuries" },
          { value: "serious", label: "Serious injuries" }
        ]
      },
      {
        name: "injury_description",
        label: "If Injuries Occurred, Describe",
        type: "textarea",
        required: false,
        maxLength: 1000
      },
      {
        name: "medical_followup",
        label: "Medical Follow-Up",
        type: "textarea",
        required: false,
        helpText: "EMS transport, hospital visit, first aid, etc.",
        maxLength: 800
      },
      {
        name: "notifications",
        label: "Notifications Made",
        type: "multiselect",
        required: true,
        options: [
          { value: "supervisor", label: "Supervisor notified" },
          { value: "program_director", label: "Program Director notified" },
          { value: "parent_guardian", label: "Parent/guardian notified" },
          { value: "partner_agency", label: "Partner agency notified" },
          { value: "none", label: "No notifications made" }
        ]
      },
      {
        name: "followup_needed",
        label: "Follow-Up Needed",
        type: "textarea",
        required: false,
        helpText: "Safety planning, mediation, referral, case management, etc.",
        maxLength: 1000
      },
      {
        name: "staff_name",
        label: "Reporting Staff Name",
        type: "text",
        required: true
      },
      {
        name: "staff_role",
        label: "Reporting Staff Role",
        type: "text",
        required: true
      },
      {
        name: "supervisor_name",
        label: "Supervisor Notified (Name)",
        type: "text",
        required: false
      },
      {
        name: "submission_date",
        label: "Date Report Completed",
        type: "date",
        required: true
      }
    ]
  },
  {
    slug: 'time_off_request',
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
    slug: 'equipment_request',
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
      { name: 'justification', label: 'Business Justification', type: 'textarea', required: true },
      { name: 'supervisorEmail', label: 'Supervisor Email', type: 'email', required: true },
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
          {FORMS.map(form => (
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
