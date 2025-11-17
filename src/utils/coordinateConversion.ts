/**
 * Coordinate conversion utilities for transforming geographic coordinates
 * (latitude, longitude, altitude) to 3D Cartesian coordinates on a globe.
 */

// Earth radius in scene units (scaled up for Float32 precision)
// Using 1000 instead of 1.0 to preserve precision for narrow satellite tracks
// At radius 1.0, variations of 0.00006 are lost in Float32 precision
// At radius 1000, variations of 60 are easily representable
const EARTH_RADIUS = 1000.0

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
 * Convert latitude, longitude, and altitude to 3D Cartesian coordinates on a globe
 * using a local tangent plane approximation centered at the data centroid.
 * This preserves precision for narrow satellite tracks by working in a local coordinate system.
 *
 * @param lat Latitude in degrees
 * @param lon Longitude in degrees
 * @param alt Altitude in kilometers
 * @param centerLat Centroid latitude in degrees
 * @param centerLon Centroid longitude in degrees
 * @param centerAlt Centroid altitude in kilometers
 * @param altitudeExaggeration Altitude exaggeration factor (default: 15)
 * @returns Object with x, y, z coordinates in local tangent plane
 */
export function latLonAltToVector3Local(
  lat: number,
  lon: number,
  alt: number,
  centerLat: number,
  centerLon: number,
  centerAlt: number,
  altitudeExaggeration: number = 15.0
): { x: number; y: number; z: number } {
  // Convert center to spherical coordinates
  const centerPhi = (90 - centerLat) * (Math.PI / 180)
  const centerTheta = centerLon * (Math.PI / 180)
  const centerRadius = EARTH_RADIUS + (centerAlt / EARTH_RADIUS_KM) * altitudeExaggeration

  // Calculate local East-North-Up basis vectors at center point
  // East vector (tangent to longitude)
  const eastX = -Math.sin(centerTheta)
  const eastY = 0
  const eastZ = Math.cos(centerTheta)

  // North vector (tangent to latitude)
  const northX = -Math.cos(centerPhi) * Math.cos(centerTheta)
  const northY = Math.sin(centerPhi)
  const northZ = -Math.cos(centerPhi) * Math.sin(centerTheta)

  // Up vector (radial)
  const upX = Math.sin(centerPhi) * Math.cos(centerTheta)
  const upY = Math.cos(centerPhi)
  const upZ = -Math.sin(centerPhi) * Math.sin(centerTheta)

  // Calculate offsets in meters from center
  const latDiff = lat - centerLat
  const lonDiff = lon - centerLon
  const altDiff = alt - centerAlt

  // Convert degree differences to meters
  const metersPerDegreeLat = 111320.0 // meters per degree latitude (approximately constant)
  const metersPerDegreeLon = 111320.0 * Math.cos(centerLat * Math.PI / 180) // varies with latitude

  const northMeters = latDiff * metersPerDegreeLat
  const eastMeters = lonDiff * metersPerDegreeLon
  const upMeters = altDiff * 1000.0 // km to meters

  // Scale to scene units (EARTH_RADIUS = 1.0 represents ~6371 km)
  const scale = EARTH_RADIUS / (EARTH_RADIUS_KM * 1000.0) // scene units per meter

  const northScene = northMeters * scale
  const eastScene = eastMeters * scale
  const upScene = upMeters * scale * altitudeExaggeration

  // Combine using local basis vectors
  const x = centerRadius * upX + eastScene * eastX + northScene * northX + upScene * upX
  const y = centerRadius * upY + eastScene * eastY + northScene * northY + upScene * upY
  const z = centerRadius * upZ + eastScene * eastZ + northScene * northZ + upScene * upZ

  return { x, y, z }
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

/**
 * Calculate a new geographic point at a given distance and bearing from a starting point.
 * Uses the Haversine formula for spherical earth calculations.
 *
 * @param lat Starting latitude in degrees
 * @param lon Starting longitude in degrees
 * @param distanceKm Distance to travel in kilometers
 * @param bearingDeg Bearing/direction in degrees (0=North, 90=East, 180=South, 270=West)
 * @returns Object with new latitude and longitude
 */
export function calculatePointAtDistanceAndBearing(
  lat: number,
  lon: number,
  distanceKm: number,
  bearingDeg: number
): { lat: number; lon: number } {
  // Convert to radians
  const latRad = lat * (Math.PI / 180)
  const lonRad = lon * (Math.PI / 180)
  const bearingRad = bearingDeg * (Math.PI / 180)

  // Angular distance in radians
  const angularDistance = distanceKm / EARTH_RADIUS_KM

  // Calculate new latitude
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
    Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  )

  // Calculate new longitude
  const newLonRad = lonRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
    Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad)
  )

  // Convert back to degrees
  const newLat = newLatRad * (180 / Math.PI)
  let newLon = newLonRad * (180 / Math.PI)

  // Normalize longitude to -180 to 180 range
  while (newLon > 180) newLon -= 360
  while (newLon < -180) newLon += 360

  return { lat: newLat, lon: newLon }
}

/**
 * Check if a point is inside a polygon using the ray-casting algorithm.
 *
 * @param point Object with lat and lon properties
 * @param polygon Array of vertices, each with lat and lon properties
 * @returns true if point is inside polygon, false otherwise
 */
export function isPointInPolygon(
  point: { lat: number; lon: number },
  polygon: Array<{ lat: number; lon: number }>
): boolean {
  if (polygon.length < 3) return false

  let inside = false
  const x = point.lon
  const y = point.lat

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon
    const yi = polygon[i].lat
    const xj = polygon[j].lon
    const yj = polygon[j].lat

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi)

    if (intersect) inside = !inside
  }

  return inside
}
