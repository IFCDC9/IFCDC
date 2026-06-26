import { useState, useEffect } from 'react';

export default function FormRenderer({ formDef, onSubmit }) {
  const [values, setValues] = useState({});

  useEffect(() => {
    if (formDef?.fields) {
      const init = {};
      formDef.fields.forEach(f => {
        if (f.type === 'checkbox') {
          init[f.name] = false;
        } else if (f.type === 'multiselect') {
          init[f.name] = [];
        } else {
          init[f.name] = '';
        }
      });
      setValues(init);
    }
  }, [formDef]);

  if (!formDef) return <div className="form-placeholder">Select a form to begin.</div>;

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  };

  const handleMultiselect = (name, value, checked) => {
    setValues(prev => {
      const current = prev[name] || [];
      if (checked) {
        return { ...prev, [name]: [...current, value] };
      } else {
        return { ...prev, [name]: current.filter(v => v !== value) };
      }
    });
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit(values);
  };

  const renderField = (field) => {
    const commonProps = {
      id: field.name,
      name: field.name,
      required: field.required,
      placeholder: field.placeholder || '',
      maxLength: field.maxLength,
    };

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'number':
      case 'date':
      case 'time':
        return (
          <input
            {...commonProps}
            type={field.type}
            value={values[field.name] || ''}
            onChange={e => handleChange(field.name, e.target.value)}
          />
        );

      case 'textarea':
        return (
          <textarea
            {...commonProps}
            value={values[field.name] || ''}
            onChange={e => handleChange(field.name, e.target.value)}
          />
        );

      case 'select':
        return (
          <select
            {...commonProps}
            value={values[field.name] || ''}
            onChange={e => handleChange(field.name, e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'multiselect':
        return (
          <div className="multiselect-group">
            {field.options?.map(opt => (
              <label key={opt.value} className="checkbox-option">
                <input
                  type="checkbox"
                  checked={(values[field.name] || []).includes(opt.value)}
                  onChange={e => handleMultiselect(field.name, opt.value, e.target.checked)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <label className="checkbox-single">
            <input
              type="checkbox"
              checked={values[field.name] || false}
              onChange={e => handleChange(field.name, e.target.checked)}
            />
            {field.label}
          </label>
        );

      case 'radio':
        return (
          <div className="radio-group">
            {field.options?.map(opt => (
              <label key={opt.value} className="radio-option">
                <input
                  type="radio"
                  name={field.name}
                  value={opt.value}
                  checked={values[field.name] === opt.value}
                  onChange={e => handleChange(field.name, e.target.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        );

      default:
        return (
          <input
            {...commonProps}
            type="text"
            value={values[field.name] || ''}
            onChange={e => handleChange(field.name, e.target.value)}
          />
        );
    }
  };

  return (
    <form onSubmit={submit} className="form-renderer">
      <h2>{formDef.title}</h2>
      <p className="form-description">{formDef.description}</p>
      {formDef.version && <span className="form-version">Version {formDef.version}</span>}
      
      {formDef.fields.map(field => (
        <div key={field.name} className="form-field">
          {field.type !== 'checkbox' && (
            <label htmlFor={field.name}>
              {field.label}
              {field.required && <span className="required">*</span>}
            </label>
          )}
          {renderField(field)}
          {field.helpText && <span className="help-text">{field.helpText}</span>}
        </div>
      ))}
      
      <button type="submit">Submit</button>
    </form>
  );
}
