import { apiRequest } from './client';

export function getBookings(token) {
  return apiRequest('/api/barbershop', {}, token);
}

export function createBooking(token, data) {
  return apiRequest('/api/barbershop', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
}

export function updateBookingStatus(token, id, status) {
  return apiRequest(`/api/barbershop/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }, token);
}

export function deleteBooking(token, id) {
  return apiRequest(`/api/barbershop/${id}`, {
    method: 'DELETE',
  }, token);
}
