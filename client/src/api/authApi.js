import apiClient from './client';

export async function login(email, password) {
  return apiClient('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(name, email, password) {
  return apiClient('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, passwordHash: password }),
  });
}
