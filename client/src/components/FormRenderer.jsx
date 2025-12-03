import { useState, useEffect } from 'react';

export default function FormRenderer({ formDef, onSubmit }) {
  const [values, setValues] = useState({});

  useEffect(() => {
    if (formDef?.fields) {
      const init = {};
      formDef.fields.forEach(f => { init[f.name] = ''; });
      setValues(init);
    }
  }, [formDef]);

  if (!formDef) return <div>Select a form to begin.</div>;

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={submit} className="form-renderer">
      <h2>{formDef.title}</h2>
      <p>{formDef.description}</p>
      {formDef.fields.map(field => (
        <label key={field.name} className="form-field">
          {field.label}
          {field.type === 'text' && (
            <input
              type="text"
              value={values[field.name] || ''}
              onChange={e => handleChange(field.name, e.target.value)}
            />
          )}
          {field.type === 'textarea' && (
            <textarea
              value={values[field.name] || ''}
              onChange={e => handleChange(field.name, e.target.value)}
            />
          )}
          {field.type === 'select' && (
            <select
              value={values[field.name] || ''}
              onChange={e => handleChange(field.name, e.target.value)}
            >
              <option value="">Select...</option>
              {field.options?.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
        </label>
      ))}
      <button type="submit">Submit</button>
    </form>
  );
}
