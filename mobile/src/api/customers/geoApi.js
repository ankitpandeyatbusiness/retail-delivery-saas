import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Places in India for what was typed, nearest to (lat, lng) first, each with distanceKm and deliverable.
export const suggestPlaces = ({ q, lat, lng }) => d(api.get('/geo/suggest', { params: { q, ...(lat != null ? { lat, lng } : {}) } }));

// The point of a suggestion that came with a name only.
export const placeById = (id) => d(api.get('/geo/place', { params: { id } }));
