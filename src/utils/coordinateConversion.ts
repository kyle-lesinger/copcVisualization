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
