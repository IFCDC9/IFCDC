import { apiRequest } from './client';

export function getChapters(token) {
  return apiRequest('/chapters', {}, token);
}

export function getChapterById(id, token) {
  return apiRequest(`/chapters/${id}`, {}, token);
}

export function acknowledgeChapter(id, token) {
  return apiRequest(`/chapters/${id}/acknowledge`, {
    method: 'POST',
  }, token);
}
