import { apiRequest } from './client';

export async function getUsers() {
  return apiRequest('/users');
}

export async function getUser(id) {
  return apiRequest(`/users/${id}`);
}
