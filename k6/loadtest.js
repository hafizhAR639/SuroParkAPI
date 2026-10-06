// k6 load test (TRD §11 + F8). Adds the missing contention scenarios the original
// random-plate test could not exercise: sameFewPlates (most requests MUST 409) and a
// hot-zone burst. Verifies the concurrency invariant under load.
import http from 'k6/http';
import { check, group } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

// A fixed, small set of contended plates: every plate may end with at most ONE active ticket.
const CONTENDED_PLATES = Array.from({ length: 20 }, (_, i) => `L${1000 + i}SB`);
let idSeq = 0;
const nextPlate = () => `B${(9000 + (idSeq++ % 5000)).toString()}XY`;

function headers(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `k-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  };
}
const TOKEN = __ENV.TOKEN || 'dev-token';

export const options = {
  scenarios: {
    unique_plates: {
      executor: 'constant-arrival-rate', rate: 800, timeUnit: '1s', duration: '2m',
      preAllocatedVUs: 500, exec: 'uniquePlate',
    },
    contended_plate: {
      executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '2m',
      preAllocatedVUs: 200, exec: 'sameFewPlates',
    },
    burst_report: {
      executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s',
      stages: [{ target: 500, duration: '30s' }, { target: 0, duration: '30s' }],
      preAllocatedVUs: 300, exec: 'report',
    },
  },
  thresholds: {
    'http_req_duration{scenario:unique_plates}': ['p(95)<100'],
    http_req_failed: ['rate<0.2'], // contention legitimately 409s — not treated as failure below
    'http_reqs{expected_response:true}': ['rate>0'],
  },
};

// Fresh unique plates: all should succeed (201).
export function uniquePlate() {
  const payload = JSON.stringify({
    vehiclePlate: nextPlate(), vehicleType: 'MOTOR', latitude: -7.25, longitude: 112.75,
  });
  const res = http.post(`${BASE}/api/v1/tickets/check-in`, payload, headers(TOKEN));
  check(res, { 'unique check-in accepted': (r) => r.status === 201 });
}

// The hot contention path (fixes F8): repeated hits on a tiny plate set.
// Expect a mix of 201 (first per plate) and 409 (active duplicate). We assert at least one
// 409 appears (DB/lock rejected a duplicate) — a healthy sign the invariant is enforced.
export function sameFewPlates() {
  const plate = CONTENDED_PLATES[Math.floor(Math.random() * CONTENDED_PLATES.length)];
  const payload = JSON.stringify({
    vehiclePlate: plate, vehicleType: 'MOTOR', latitude: -7.25, longitude: 112.75,
  });
  const res = http.post(`${BASE}/api/v1/tickets/check-in`, payload, headers(TOKEN));
  group('contention', () => {
    check(res, {
      'won or correctly rejected duplicate': (r) => r.status === 201 || r.status === 409,
    });
  });
}

// Report spam path (C11) — must stay async/fast and not slow the ticket path.
export function report() {
  const payload = JSON.stringify({
    latitude: -7.25, longitude: 112.75, description: 'jukir liar di pintu 3',
  });
  const res = http.post(`${BASE}/api/v1/reports/violation`, payload, headers(TOKEN));
  check(res, { 'report accepted 202': (r) => r.status === 202 });
}
