// Talks to a self-hosted Spoolman instance (https://github.com/Donkie/Spoolman)
// to read spool prices/remaining weight and to book filament usage after a
// print, so filament cost no longer needs to be typed in by hand.

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

async function smRequest(baseUrl, path, opts = {}) {
  const url = `${stripTrailingSlash(baseUrl)}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    throw new Error(`spoolman_unreachable: ${err.message}`);
  }
  if (!res.ok) throw new Error(`spoolman_http_${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

// Preis/kg einer Spule: bevorzugt der individuelle Spool-Preis (falls beim Anlegen
// gesetzt), sonst der Preis des zugrunde liegenden Filaments, geteilt durch dessen
// Netto-Gewicht (filament.weight = Gramm Filament auf einer vollen Spule).
function pricePerKg(spool) {
  const totalWeight = spool.filament?.weight || null;
  const price = spool.price ?? spool.filament?.price ?? null;
  return (price != null && totalWeight) ? price / (totalWeight / 1000) : null;
}

function toOption(spool) {
  return {
    id: spool.id,
    label: [spool.filament?.vendor?.name, spool.filament?.name, spool.filament?.material]
      .filter(Boolean).join(' ') || `Spule #${spool.id}`,
    remaining_weight: spool.remaining_weight ?? null,
    price_per_kg: pricePerKg(spool),
    density_g_cm3: spool.filament?.density ?? null,
  };
}

async function fetchSpools(baseUrl) {
  const spools = await smRequest(baseUrl, '/api/v1/spool?archived=false');
  return spools.map(toOption);
}

async function fetchOneSpool(baseUrl, spoolId) {
  const spool = await smRequest(baseUrl, `/api/v1/spool/${spoolId}`);
  return toOption(spool);
}

// Bucht verbrauchtes Filament auf der Spule (Spoolman zieht es vom Restgewicht ab).
async function useSpool(baseUrl, spoolId, grams) {
  return smRequest(baseUrl, `/api/v1/spool/${spoolId}/use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ use_weight: grams }),
  });
}

module.exports = { fetchSpools, fetchOneSpool, useSpool };
