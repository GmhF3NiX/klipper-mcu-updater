// Talks to the Home Assistant REST API (Long-Lived Access Token) to read
// back how much energy a print used, based on an existing HA energy sensor
// (e.g. a Zigbee smart plug on the printer with device_class: energy,
// state_class: total_increasing). Works against any HA install — OS,
// Supervised, or plain Container — since it's just HTTP + a token.

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

async function haRequest(baseUrl, token, path) {
  const url = `${stripTrailingSlash(baseUrl)}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new Error(`ha_unreachable: ${err.message}`);
  }
  if (!res.ok) throw new Error(`ha_http_${res.status}`);
  return res.json();
}

async function fetchCurrentState(baseUrl, token, entityId) {
  return haRequest(baseUrl, token, `/api/states/${encodeURIComponent(entityId)}`);
}

// Returns the kWh consumed between startedAtMs and endedAtMs, read from a
// cumulative (total_increasing) energy sensor's history.
async function fetchEnergyDelta(baseUrl, token, entityId, startedAtMs, endedAtMs) {
  const start = new Date(startedAtMs).toISOString();
  const end = new Date(endedAtMs).toISOString();
  const path = `/api/history/period/${encodeURIComponent(start)}` +
    `?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(end)}&minimal_response`;

  const data = await haRequest(baseUrl, token, path);
  const series = (data && data[0]) || [];
  const values = series
    .map(s => parseFloat(s.state))
    .filter(n => Number.isFinite(n));

  if (values.length < 2) throw new Error('ha_no_data');

  const delta = values[values.length - 1] - values[0];
  if (delta < 0) throw new Error('ha_counter_reset');
  return delta;
}

module.exports = { fetchCurrentState, fetchEnergyDelta };
