/**
 * Area of Interest (AOI) selection utilities
 */

export interface LatLon {
  lat: number
  lon: number
}

/**
 * Test if a point is inside a polygon using ray casting algorithm
 * Works for geographic coordinates (lat/lon)
 * @param point The point to test
 * @param polygon Array of polygon vertices (must be closed: first == last, or will auto-close)
 * @returns true if point is inside polygon
 */
export function isPointInPolygon(point: LatLon, polygon: LatLon[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  const { lat, lon } = point

  // Ensure polygon is closed
  const vertices = [...polygon]
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  if (first.lat !== last.lat || first.lon !== last.lon) {
    vertices.push(first)
  }

  // Ray casting algorithm
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]
    const vj = vertices[j]

    // Check if point is on edge of polygon
    if (
      (vi.lon > lon) !== (vj.lon > lon) &&
      lat < ((vj.lat - vi.lat) * (lon - vi.lon)) / (vj.lon - vi.lon) + vi.lat
    ) {
      inside = !inside
    }
  }

  return inside
}

/**
 * Filter point cloud data by AOI polygon
 * @param positions Float32Array of positions [x, y, z, x, y, z, ...]
 * @param intensities Uint16Array of intensity values
 * @param polygon AOI polygon vertices
 * @returns Filtered data with altitudes and intensities
 */
export function filterDataByAOI(
  positions: Float32Array,
  intensities: Uint16Array,
  polygon: LatLon[]
): { altitudes: number[], intensities: number[] } {
  const altitudes: number[] = []
  const filteredIntensities: number[] = []

  const count = positions.length / 3

  for (let i = 0; i < count; i++) {
    const lon = positions[i * 3]     // X = longitude
    const lat = positions[i * 3 + 1] // Y = latitude
    const alt = positions[i * 3 + 2] // Z = altitude in km

    const point: LatLon = { lat, lon }

    if (isPointInPolygon(point, polygon)) {
      altitudes.push(alt)
      filteredIntensities.push(intensities[i])
    }
  }

  return { altitudes, intensities: filteredIntensities }
}

/**
 * Calculate the bounds of a polygon
 * @param polygon Array of polygon vertices
 * @returns Bounding box { minLat, maxLat, minLon, maxLon }
 */
export function getPolygonBounds(polygon: LatLon[]): {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
} {
  if (polygon.length === 0) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 }
  }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  polygon.forEach(({ lat, lon }) => {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
  })

  return { minLat, maxLat, minLon, maxLon }
}
