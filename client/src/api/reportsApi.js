import { apiRequest } from './client';

export function getOverview(token) {
  return apiRequest('/api/reports/overview', {}, token);
}

export function getIncidentsByProgram(token) {
  return apiRequest('/api/reports/incidents/by-program', {}, token);
}

export function getIncidentsTimeSeries(token, days = 30) {
  return apiRequest(`/api/reports/incidents/time-series?days=${days}`, {}, token);
}

export function exportIncidentsCsv(token, start, end) {
  let url = '/api/reports/incidents/export/csv';
  const params = [];
  if (start) params.push(`start=${start}`);
  if (end) params.push(`end=${end}`);
  if (params.length) url += `?${params.join('&')}`;
  return apiRequest(url, {}, token);
}
