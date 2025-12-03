import apiClient from './client';

export async function getChapters() {
  return apiClient('/chapters');
}

export async function getChapter(id) {
  return apiClient(`/chapters/${id}`);
}

export async function createChapter(data) {
  return apiClient('/chapters', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateChapter(id, data) {
  return apiClient(`/chapters/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
