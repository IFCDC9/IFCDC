import { apiRequest } from './client';

export async function getForms(token) {
  return apiRequest('/api/forms/active', {}, token);
}

export async function getFormById(id, token) {
  return apiRequest(`/api/forms/${id}`, {}, token);
}

export async function getFormBySlug(slug, token) {
  return apiRequest(`/api/forms/slug/${slug}`, {}, token);
}

export async function createForm(formData, token) {
  return apiRequest('/api/forms', {
    method: 'POST',
    body: JSON.stringify(formData),
  }, token);
}

export async function updateForm(id, formData, token) {
  return apiRequest(`/api/forms/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(formData),
  }, token);
}

export async function deleteForm(id, token) {
  return apiRequest(`/api/forms/${id}`, {
    method: 'DELETE',
  }, token);
}

export async function submitForm(formId, submittedById, data, token) {
  return apiRequest(`/api/forms/${formId}/submissions`, {
    method: 'POST',
    body: JSON.stringify({ submittedById, data }),
  }, token);
}

export async function getFormSubmissions(formId, token) {
  return apiRequest(`/api/forms/${formId}/submissions`, {}, token);
}
