import { apiRequest } from './client';

export function getUsers(token) {
  return apiRequest('/users', {}, token);
}

export function getUserById(id, token) {
  return apiRequest(`/users/${id}`, {}, token);
}
