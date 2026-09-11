export type Map3dBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export function validateBounds(bounds: Map3dBounds): void {
  const { north, south, east, west } = bounds;
  for (const [name, value] of Object.entries(bounds)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  }
  if (north <= south) throw new Error('north must be greater than south.');
  if (east <= west) throw new Error('east must be greater than west.');
  if (south < -90 || north > 90) throw new Error('latitude must be within -90..90.');
  if (west < -180 || east > 180) throw new Error('longitude must be within -180..180.');

  const latSpan = north - south;
  const lonSpan = east - west;
  if (latSpan > 0.25 || lonSpan > 0.25) {
    throw new Error('Map3D v0.1 limits a request to a 0.25° x 0.25° bounding box to protect Overpass and the runtime.');
  }
}

export function planMap3dRequest(bounds: Map3dBounds) {
  validateBounds(bounds);
  const { north, south, east, west } = bounds;
  const bbox = `${south},${west},${north},${east}`;

  return {
    bounds,
    center: {
      lat: (north + south) / 2,
      lng: (east + west) / 2
    },
    source: 'OpenStreetMap via Overpass API',
    endpoint: 'https://overpass-api.de/api/interpreter',
    method: 'POST',
    queries: {
      buildings: `[out:json][timeout:25];(way["building"](${bbox});relation["building"](${bbox}););out body geom;`,
      roads: `[out:json][timeout:25];(way["highway"](${bbox}););out body geom;`
    },
    renderer: {
      repo: 'mardukasoka/map3d',
      currentMode: 'browser',
      geometry: 'Three.js / React Three Fiber',
      export: 'GLB via GLTFExporter'
    },
    limitations: [
      'This tool plans and validates the geographic request; it does not yet render GLB headlessly.',
      'OSM building heights may be absent or inaccurate.',
      'The current Map3D renderer and GLB exporter are browser/DOM coupled.'
    ]
  };
}
