import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getForms, submitForm } from '../api/formsApi';
import FormRenderer from '../components/FormRenderer';

const DEFAULT_FORMS = [
  {
    id: 'local-1',
    slug: "incident_report",
    title: "Incident Report",
    schema: {
      description: "Use this form to document any significant safety, behavioral, medical, or field incident involving a participant, visitor, or staff member.",
      version: 1,
      fields: [
        { name: "incident_date", label: "Incident Date", type: "date", required: true },
        { name: "incident_time", label: "Incident Time", type: "time", required: true },
        { name: "location", label: "Location of Incident", type: "text", required: true, placeholder: "Program site, street location, school, etc." },
        {
          name: "program", label: "Program Area", type: "select", required: true,
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
          name: "incident_type", label: "Incident Type", type: "multiselect", required: true,
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
        { name: "participants_involved", label: "Names of Individuals Involved", type: "textarea", required: true, placeholder: "List participants, staff, visitors, etc.", maxLength: 500 },
        { name: "incident_summary", label: "Incident Summary (Factual Narrative)", type: "textarea", required: true, helpText: "Describe what happened in chronological, factual, non-judgmental language.", maxLength: 2000 },
        { name: "immediate_actions_taken", label: "Immediate Actions Taken by Staff", type: "textarea", required: true, helpText: "De-escalation steps, first aid, separation, 911 call, etc.", maxLength: 1500 },
        {
          name: "law_enforcement_involved", label: "Was Law Enforcement Involved?", type: "radio", required: true,
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
        },
        { name: "law_enforcement_details", label: "If Yes, Describe Law Enforcement Involvement", type: "textarea", required: false, maxLength: 1000 },
        {
          name: "injuries", label: "Were There Any Injuries?", type: "radio", required: true,
          options: [
            { value: "none", label: "No injuries reported" },
            { value: "minor", label: "Minor injuries" },
            { value: "serious", label: "Serious injuries" }
          ]
        },
        { name: "injury_description", label: "If Injuries Occurred, Describe", type: "textarea", required: false, maxLength: 1000 },
        { name: "medical_followup", label: "Medical Follow-Up", type: "textarea", required: false, helpText: "EMS transport, hospital visit, first aid, etc.", maxLength: 800 },
        {
          name: "notifications", label: "Notifications Made", type: "multiselect", required: true,
          options: [
            { value: "supervisor", label: "Supervisor notified" },
            { value: "program_director", label: "Program Director notified" },
            { value: "parent_guardian", label: "Parent/guardian notified" },
            { value: "partner_agency", label: "Partner agency notified" },
            { value: "none", label: "No notifications made" }
          ]
        },
        { name: "followup_needed", label: "Follow-Up Needed", type: "textarea", required: false, helpText: "Safety planning, mediation, referral, case management, etc.", maxLength: 1000 },
        { name: "staff_name", label: "Reporting Staff Name", type: "text", required: true },
        { name: "staff_role", label: "Reporting Staff Role", type: "text", required: true },
        { name: "supervisor_name", label: "Supervisor Notified (Name)", type: "text", required: false },
        { name: "submission_date", label: "Date Report Completed", type: "date", required: true }
      ]
    }
  },
  {
    id: 'local-2',
    slug: "participant_intake",
    title: "Participant Intake Form",
    schema: {
      description: "Use this form to complete intake for a new participant entering any IFCDC program.",
      version: 1,
      fields: [
        { name: "intake_date", label: "Intake Date", type: "date", required: true },
        { name: "participant_first_name", label: "First Name", type: "text", required: true },
        { name: "participant_last_name", label: "Last Name", type: "text", required: true },
        { name: "dob", label: "Date of Birth", type: "date", required: true },
        { name: "age", label: "Age", type: "number", required: false },
        { name: "phone", label: "Primary Phone Number", type: "tel", required: false },
        { name: "email", label: "Email Address", type: "email", required: false },
        { name: "address", label: "Street Address", type: "textarea", required: false, maxLength: 300 },
        { name: "city", label: "City", type: "text", required: false },
        { name: "zip", label: "ZIP Code", type: "text", required: false },
        {
          name: "preferred_contact_method", label: "Preferred Contact Method", type: "select", required: false,
          options: [
            { value: "phone", label: "Phone" },
            { value: "text", label: "Text message" },
            { value: "email", label: "Email" }
          ]
        },
        { name: "guardian_name", label: "Parent/Guardian Name (if applicable)", type: "text", required: false },
        { name: "guardian_phone", label: "Parent/Guardian Phone", type: "tel", required: false },
        { name: "emergency_contact_name", label: "Emergency Contact Name", type: "text", required: true },
        { name: "emergency_contact_phone", label: "Emergency Contact Phone", type: "tel", required: true },
        {
          name: "referral_source", label: "How Did Participant Hear About IFCDC?", type: "select", required: false,
          options: [
            { value: "school", label: "School" },
            { value: "court_probation", label: "Court / Probation" },
            { value: "agency", label: "Partner Agency" },
            { value: "family_friend", label: "Family / Friend" },
            { value: "self", label: "Self-referral" },
            { value: "social_media", label: "Social Media" },
            { value: "other", label: "Other" }
          ]
        },
        {
          name: "primary_program", label: "Primary Program Requested", type: "select", required: true,
          options: [
            { value: "youth_development", label: "Youth Development" },
            { value: "cvi", label: "Community Violence Intervention (CVI)" },
            { value: "workforce", label: "Workforce Development" },
            { value: "barbershop", label: "Barbershop Workforce Pipeline" },
            { value: "family_services", label: "Family Services" },
            { value: "radio_media", label: "IFCDC Radio & Media Program" }
          ]
        },
        {
          name: "education_status", label: "Current Education Status", type: "select", required: false,
          options: [
            { value: "in_school", label: "In school" },
            { value: "graduated", label: "High school graduate / GED" },
            { value: "some_college", label: "Some college" },
            { value: "not_in_school", label: "Not currently in school" }
          ]
        },
        {
          name: "employment_status", label: "Current Employment Status", type: "select", required: false,
          options: [
            { value: "unemployed", label: "Unemployed" },
            { value: "part_time", label: "Part-time" },
            { value: "full_time", label: "Full-time" },
            { value: "informal_work", label: "Informal work / side jobs" }
          ]
        },
        {
          name: "housing_status", label: "Current Housing Situation", type: "select", required: false,
          options: [
            { value: "stable", label: "Stable housing" },
            { value: "temporarily_with_family", label: "Temporarily with family/friends" },
            { value: "shelter", label: "Shelter / transitional housing" },
            { value: "unstable", label: "Unstable / at risk of homelessness" }
          ]
        },
        { name: "primary_goals", label: "Participant's Primary Goals", type: "textarea", required: false, helpText: "In their own words or as described by the participant.", maxLength: 800 },
        { name: "support_needs", label: "Key Support Needs", type: "textarea", required: false, helpText: "E.g., employment, school support, conflict mediation, housing support, etc.", maxLength: 800 },
        { name: "risk_safety_flags", label: "Any Immediate Safety or Risk Concerns?", type: "textarea", required: false, helpText: "Note if there are any urgent concerns that require attention.", maxLength: 800 },
        { name: "consent_to_services", label: "Consent to Receive Services", type: "checkbox", required: true },
        { name: "consent_to_contact", label: "Consent to Be Contacted by Phone/Text/Email", type: "checkbox", required: true },
        { name: "staff_name", label: "Intake Staff Name", type: "text", required: true },
        { name: "staff_role", label: "Intake Staff Role", type: "text", required: true }
      ]
    }
  },
  {
    id: 'local-3',
    slug: "case_note",
    title: "Case Note",
    schema: {
      description: "Use this form to document contacts, sessions, and follow-up with participants.",
      version: 1,
      fields: [
        { name: "note_date", label: "Date of Contact/Session", type: "date", required: true },
        { name: "note_time", label: "Time of Contact/Session", type: "time", required: false },
        { name: "participant_identifier", label: "Participant Name or ID", type: "text", required: true, helpText: "Use participant ID if available; otherwise full name." },
        {
          name: "program", label: "Program Area", type: "select", required: true,
          options: [
            { value: "youth_development", label: "Youth Development" },
            { value: "cvi", label: "Community Violence Intervention (CVI)" },
            { value: "workforce", label: "Workforce Development" },
            { value: "barbershop", label: "Barbershop Workforce Pipeline" },
            { value: "family_services", label: "Family Services" },
            { value: "radio_media", label: "IFCDC Radio & Media" }
          ]
        },
        {
          name: "contact_type", label: "Type of Contact", type: "select", required: true,
          options: [
            { value: "in_person", label: "In-person session" },
            { value: "phone_call", label: "Phone call" },
            { value: "video", label: "Video session" },
            { value: "text_message", label: "Text message" },
            { value: "field_outreach", label: "Field outreach contact" }
          ]
        },
        { name: "contact_location", label: "Location (If In-Person or Field)", type: "text", required: false, placeholder: "Program site, community location, home visit, etc." },
        {
          name: "session_focus", label: "Primary Focus of Session", type: "multiselect", required: false,
          options: [
            { value: "engagement_checkin", label: "Engagement / check-in" },
            { value: "school_support", label: "School support" },
            { value: "employment", label: "Employment / job search" },
            { value: "conflict_mediation", label: "Conflict mediation" },
            { value: "court_probation", label: "Court/probation related" },
            { value: "family_support", label: "Family support" },
            { value: "mental_health_referral", label: "Mental health referral/support" },
            { value: "safety_planning", label: "Safety planning" },
            { value: "other", label: "Other" }
          ]
        },
        { name: "summary", label: "Summary of Contact/Session", type: "textarea", required: true, helpText: "Briefly summarize what occurred and what was discussed.", maxLength: 2000 },
        { name: "participant_response", label: "Participant Response / Engagement Level", type: "textarea", required: false, maxLength: 800 },
        { name: "goals_addressed", label: "Goals or Service Plan Items Addressed", type: "textarea", required: false, maxLength: 800 },
        { name: "referrals_made", label: "Referrals or Linkages Made", type: "textarea", required: false, helpText: "Include partner agencies or services.", maxLength: 800 },
        { name: "followup_actions", label: "Follow-Up Actions / Next Steps", type: "textarea", required: false, maxLength: 800 },
        { name: "followup_date", label: "Planned Follow-Up Date (If Any)", type: "date", required: false },
        { name: "staff_name", label: "Staff Completing Note", type: "text", required: true },
        { name: "staff_role", label: "Staff Role", type: "text", required: true },
        {
          name: "supervisor_review_required", label: "Flag for Supervisor Review?", type: "radio", required: false,
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
        }
      ]
    }
  }
];

export default function FormsPage() {
  const { token, user } = useAuth();
  const [forms, setForms] = useState([]);
  const [selectedForm, setSelectedForm] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const dbForms = await getForms(token);
        if (dbForms && dbForms.length > 0) {
          setForms(dbForms);
        } else {
          setForms(DEFAULT_FORMS);
        }
      } catch (error) {
        console.log('Using default forms');
        setForms(DEFAULT_FORMS);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSubmit = async (values) => {
    try {
      if (selectedForm.id && typeof selectedForm.id === 'number') {
        await submitForm(selectedForm.id, user.id, values, token);
      }
      console.log('Form submitted:', selectedForm?.slug, values);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (error) {
      console.error('Submit error:', error);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    }
  };

  const getFormDef = (form) => {
    if (form.schema) {
      return {
        title: form.title,
        description: form.schema.description,
        version: form.schema.version,
        fields: form.schema.fields,
      };
    }
    return form;
  };

  if (loading) {
    return <div className="loading">Loading forms...</div>;
  }

  return (
    <div className="forms-page">
      <div className="forms-sidebar">
        <h2>Available Forms</h2>
        <ul>
          {forms.map(form => (
            <li key={form.id || form.slug}>
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
        <FormRenderer formDef={selectedForm ? getFormDef(selectedForm) : null} onSubmit={handleSubmit} />
        {submitted && <div className="form-success">Form submitted successfully!</div>}
      </div>
    </div>
  );
}
