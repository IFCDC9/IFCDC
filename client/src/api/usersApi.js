import apiClient from './client';

export async function getUsers() {
  return apiClient('/users');
}

export async function getUser(id) {
  return apiClient(`/users/${id}`);
}
