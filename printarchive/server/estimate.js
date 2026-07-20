// Faustformel-Schätzung für Filamentverbrauch, Druckzeit und Kosten aus Modellgeometrie
// (Volumen/Oberfläche/Bounding-Box, vom Client aus der bereits geladenen Three.js-Mesh
// berechnet) + einem gespeicherten Druckprofil. Das ist KEIN echtes Slicing — Fülldichte,
// Wandstärke und Deckschichten werden über die Bounding-Box-Grundfläche angenähert, nicht aus
// der tatsächlichen Schicht-für-Schicht-Geometrie. Filamentgewicht ist dadurch brauchbar genau,
// die Druckzeit bleibt ein grober Richtwert (kein Beschleunigungs-/Reise-/Retract-Modell).
function estimate({ volumeMm3, surfaceAreaMm2, bboxX, bboxY, profile, densityGCm3, priceEurPerKg, powerPriceEurPerKwh }) {
  const wallThickness = profile.wall_count * profile.nozzle_diameter_mm;
  const shellVolume = surfaceAreaMm2 * wallThickness;
  const topBottomVolume = bboxX * bboxY * 2 * (profile.top_bottom_layers * profile.layer_height_mm);
  const interiorVolume = Math.max(volumeMm3 - shellVolume - topBottomVolume, 0);
  const infillVolume = interiorVolume * (profile.infill_percent / 100);
  // Deckel bei kleinem Volumen/dünnen Wänden, damit die Summe nicht über das Gesamtvolumen hinausschießt.
  const extrudedVolumeMm3 = Math.min(shellVolume + topBottomVolume + infillVolume, volumeMm3 * 1.05);

  const filamentGrams = (extrudedVolumeMm3 / 1000) * densityGCm3;

  const flowRateMm3PerS = profile.layer_height_mm * profile.nozzle_diameter_mm * profile.print_speed_mm_s;
  const printSeconds = flowRateMm3PerS > 0
    ? (extrudedVolumeMm3 / flowRateMm3PerS) * profile.speed_overhead_factor
    : 0;

  const filamentCost = (filamentGrams / 1000) * priceEurPerKg;
  const energyKwh = (profile.printer_power_watts / 1000) * (printSeconds / 3600);
  const energyCost = energyKwh * powerPriceEurPerKwh;

  return {
    filamentGrams,
    printMinutes: printSeconds / 60,
    filamentCost,
    energyCost,
    totalCost: filamentCost + energyCost,
  };
}

module.exports = { estimate };
