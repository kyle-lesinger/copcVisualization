/**
 * Coordinate conversion utilities for transforming geographic coordinates
 * (latitude, longitude, altitude) to 3D Cartesian coordinates on a globe.
 */

// Earth radius in scene units (normalized to 1.0)
const EARTH_RADIUS = 1.0

// Actual Earth radius in kilometers
const EARTH_RADIUS_KM = 6371.0

/**
 * Convert latitude, longitude, and altitude to 3D Cartesian coordinates on a globe.
 *
 * @param lat Latitude in degrees (-90 to 90)
 * @param lon Longitude in degrees (-180 to 180)
 * @param alt Altitude in kilometers above sea level
 * @param altitudeExaggeration Factor to exaggerate altitude for visibility (default: 15)
 * @returns Object with x, y, z coordinates
 */
export function latLonAltToVector3(
  lat: number,
  lon: number,
  alt: number,
  altitudeExaggeration: number = 15.0
): { x: number; y: number; z: number } {
  // Convert altitude from km to radius scale
  // Exaggerate altitude to make the vertical "curtain" visible on the globe
  const radius = EARTH_RADIUS + (alt / EARTH_RADIUS_KM) * altitudeExaggeration

  // Convert lat/lon to spherical coordinates (radians)
  const phi = (90 - lat) * (Math.PI / 180)    // Polar angle (0 at north pole)
  const theta = lon * (Math.PI / 180) // Azimuthal angle

  // Convert spherical to Cartesian coordinates
  const x = radius * Math.sin(phi) * Math.cos(theta)
  const y = radius * Math.cos(phi)
  const z = -radius * Math.sin(phi) * Math.sin(theta)

  return { x, y, z }
}

/**
 * Convert an array of lat/lon/alt coordinates to 3D Cartesian coordinates.
 * Optimized for bulk conversion of point cloud data.
 *
 * @param latLonAlt Float32Array with interleaved [lon, lat, alt, lon, lat, alt, ...]
 * @param altitudeExaggeration Factor to exaggerate altitude for visibility
 * @returns Float32Array with interleaved [x, y, z, x, y, z, ...]
 */
export function convertPointsToGlobe(
  latLonAlt: Float32Array,
  altitudeExaggeration: number = 15.0
): Float32Array {
  const numPoints = latLonAlt.length / 3
  const cartesian = new Float32Array(numPoints * 3)

  for (let i = 0; i < numPoints; i++) {
    const lon = latLonAlt[i * 3]      // X in LAS file = longitude
    const lat = latLonAlt[i * 3 + 1]  // Y in LAS file = latitude
    const alt = latLonAlt[i * 3 + 2]  // Z in LAS file = altitude (km)

    const pos = latLonAltToVector3(lat, lon, alt, altitudeExaggeration)

    cartesian[i * 3] = pos.x
    cartesian[i * 3 + 1] = pos.y
    cartesian[i * 3 + 2] = pos.z
  }

  return cartesian
}

/**
 * Get Earth radius in scene units
 */
export function getEarthRadius(): number {
  return EARTH_RADIUS
}

/**
 * Convert latitude, longitude, and altitude to 2D map coordinates (EPSG:4326 planar).
 * For visualization purposes:
 * X = longitude (scaled)
 * Y = altitude (exaggerated)
 * Z = latitude (scaled)
 *
 * @param lat Latitude in degrees (-90 to 90)
 * @param lon Longitude in degrees (-180 to 180)
 * @param alt Altitude in kilometers above sea level
 * @param altitudeExaggeration Factor to exaggerate altitude for visibility (default: 0.01)
 * @returns Object with x, y, z coordinates
 */
export function latLonAltTo2D(
  lat: number,
  lon: number,
  alt: number,
  altitudeExaggeration: number = 0.01
): { x: number; y: number; z: number } {
  // Scale longitude to reasonable range (±180 degrees)
  const x = lon * 0.01  // Scale to ±1.8 range

  // Altitude becomes Y axis (vertical)
  const y = alt * altitudeExaggeration

  // Scale latitude to reasonable range (±90 degrees)
  const z = lat * 0.01  // Scale to ±0.9 range

  return { x, y, z }
}

/**
 * Convert an array of lat/lon/alt coordinates to 2D map coordinates.
 * Optimized for bulk conversion of point cloud data.
 *
 * @param latLonAlt Float32Array with interleaved [lon, lat, alt, lon, lat, alt, ...]
 * @param altitudeExaggeration Factor to exaggerate altitude for visibility
 * @returns Float32Array with interleaved [x, y, z, x, y, z, ...]
 */
export function convertPointsTo2D(
  latLonAlt: Float32Array,
  altitudeExaggeration: number = 0.01
): Float32Array {
  const numPoints = latLonAlt.length / 3
  const cartesian = new Float32Array(numPoints * 3)

  for (let i = 0; i < numPoints; i++) {
    const lon = latLonAlt[i * 3]      // X in LAS file = longitude
    const lat = latLonAlt[i * 3 + 1]  // Y in LAS file = latitude
    const alt = latLonAlt[i * 3 + 2]  // Z in LAS file = altitude (km)

    const pos = latLonAltTo2D(lat, lon, alt, altitudeExaggeration)

    cartesian[i * 3] = pos.x
    cartesian[i * 3 + 1] = pos.y
    cartesian[i * 3 + 2] = pos.z
  }

  return cartesian
}

/**
 * Calculate the haversine distance between two geographic coordinates.
 * Returns distance in kilometers.
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @returns Distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  // Convert to radians
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const lat1Rad = lat1 * (Math.PI / 180)
  const lat2Rad = lat2 * (Math.PI / 180)

  // Haversine formula
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_KM * c
}

/**
 * Calculate the bearing (direction) from one point to another.
 * Returns bearing in degrees (0-360), where 0 is North, 90 is East, etc.
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  // Convert to radians
  const lat1Rad = lat1 * (Math.PI / 180)
  const lat2Rad = lat2 * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)

  // Calculate bearing
  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  let bearing = Math.atan2(y, x) * (180 / Math.PI)

  // Normalize to 0-360
  bearing = (bearing + 360) % 360

  return bearing
}
