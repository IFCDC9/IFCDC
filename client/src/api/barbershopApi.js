import { apiRequest } from './client';

export function getBookings(token) {
  return apiRequest('/api/bookings', {}, token);
}

export function createBooking(token, data) {
  return apiRequest('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
}

export function updateBookingStatus(token, id, status) {
  return apiRequest(`/api/bookings/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }, token);
}

export function deleteBooking(token, id) {
  return apiRequest(`/api/bookings/${id}`, {
    method: 'DELETE',
  }, token);
}
