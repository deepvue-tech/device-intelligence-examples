// Per-device events, in memory. State lives on the server, keyed by the
// Deepvue device ID, so a private window or cleared storage doesn't reset it.
// A restart forgets everything, which suits a demo; see README for production.

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 2000; // oldest-touched key is dropped beyond this
const MAX_EVENTS = 30; // per device per demo

const events = new Map(); // `${demo}:${deviceId}` -> [{ at, ... }], oldest first

export function list(demo, deviceId, now = Date.now()) {
  const key = `${demo}:${deviceId}`;
  const kept = (events.get(key) || []).filter((e) => now - e.at < TTL_MS);
  if (kept.length) events.set(key, kept);
  else events.delete(key);
  return kept.slice();
}

export function add(demo, deviceId, event) {
  const key = `${demo}:${deviceId}`;
  const all = [...(events.get(key) || []), event].slice(-MAX_EVENTS);
  events.delete(key); // re-insert so Map order tracks recency
  events.set(key, all);
  while (events.size > MAX_KEYS) events.delete(events.keys().next().value);
}

export function forget(demo, deviceId) {
  events.delete(`${demo}:${deviceId}`);
}
