import { apiRequest } from './client';

export function getHighRiskQueue(token) {
  return apiRequest('/api/queue/high-risk', {}, token);
}

export function getMyQueue(token) {
  return apiRequest('/api/queue/my-queue', {}, token);
}
