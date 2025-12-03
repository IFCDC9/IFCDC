import { apiRequest } from './client';

export async function getForms(token) {
  return apiRequest('/api/forms', {}, token);
}

export async function getFormBySlug(slug, token) {
  return apiRequest(`/api/forms/${slug}`, {}, token);
}

export async function submitForm(slug, values, token) {
  return apiRequest(`/api/forms/${slug}/submit`, {
    method: 'POST',
    body: JSON.stringify(values),
  }, token);
}

export async function getFormSubmissions(slug, token) {
  return apiRequest(`/api/forms/${slug}/submissions`, {}, token);
}

export async function getSubmissionById(id, token) {
  return apiRequest(`/api/forms/submission/${id}`, {}, token);
}
