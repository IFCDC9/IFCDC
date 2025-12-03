import { apiRequest } from './client';

export async function getChapters() {
  return apiRequest('/chapters');
}

export async function getChapter(id) {
  return apiRequest(`/chapters/${id}`);
}

export async function createChapter(data) {
  return apiRequest('/chapters', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateChapter(id, data) {
  return apiRequest(`/chapters/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
