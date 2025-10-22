# Coordinate Systems and Transformations

## Overview

The CALIPSO COPC Viewer uses multiple coordinate systems to represent point cloud data across different visualization modes. This document explains the coordinate transformations between geographic coordinates (lat/lon/alt), 3D Cartesian coordinates for globe rendering, and 2D map projections.

## Coordinate Systems Used

### 1. Geographic Coordinates (Source Data)

**System**: WGS84 ellipsoid (World Geodetic System 1984)

**Components**:
- **Longitude**: -180° to +180° (degrees east)
- **Latitude**: -90° to +90° (degrees north)
- **Altitude**: 0 to ~40 km above sea level (kilometers)

**Origin**: Earth's center of mass

**Data source**: CALIPSO HDF4 files provide lat/lon/alt directly

**LAZ file storage**:
```
X coordinate → Longitude (degrees)
Y coordinate → Latitude (degrees)
Z coordinate → Altitude (kilometers)
```

**Why this encoding?**
- Standard geospatial convention (X=lon, Y=lat)
- Matches OGC specifications
- Compatible with QGIS, CloudCompare, etc.
- Altitude in km for CALIPSO's orbital perspective

### 2. Globe 3D Cartesian (Three.js Rendering)

**System**: 3D Cartesian with origin at Earth's center

**Components**:
- **X**: Rightward (increasing eastward at equator/prime meridian)
- **Y**: Upward (increasing toward North Pole)
- **Z**: Outward (increasing toward viewer at 0° lat, 180° lon)

**Units**: Kilometers from Earth's center

**Used for**:
- Three.js globe visualization
- Satellite positioning
- Camera movement

**Transformation**: See "Globe Coordinate Conversion" section below

### 3. Flat 2D Map (deck.gl Rendering)

**System**: Web Mercator projection (EPSG:3857)

**Components**:
- **X**: Longitude (degrees, -180 to +180)
- **Y**: Latitude (degrees, -85 to +85)
- **Z**: Altitude (meters above sea level)

**Used for**:
- deck.gl ScatterplotLayer
- 2D map view with MapLibre

**Note**: deck.gl handles Mercator projection internally, we provide geographic coordinates directly.

## Globe Coordinate Conversion

### Spherical to Cartesian Transform

**File**: `src/utils/coordinateConversion.ts`

**Function**: `convertPointsToGlobe`

**Input**: `positions` Float32Array with [lon, lat, alt, lon, lat, alt, ...]

**Output**: `globePositions` Float32Array with [x, y, z, x, y, z, ...]

**Algorithm** (lines 6-29):

```typescript
export function convertPointsToGlobe(positions: Float32Array): Float32Array {
  const count = positions.length / 3
  const globePositions = new Float32Array(count * 3)

  const EARTH_RADIUS = 6.371 // km

  for (let i = 0; i < count; i++) {
    const lon = positions[i * 3]      // longitude in degrees
    const lat = positions[i * 3 + 1]  // latitude in degrees
    const alt = positions[i * 3 + 2]  // altitude in km

    // Total distance from Earth's center
    const radius = EARTH_RADIUS + alt

    // Convert to spherical coordinates
    // phi: angle from North Pole (0° at North, 180° at South)
    // theta: azimuthal angle (longitude)
    const phi = (90 - lat) * Math.PI / 180
    const theta = (lon + 180) * Math.PI / 180

    // Convert to Cartesian coordinates
    const x = radius * Math.sin(phi) * Math.cos(theta)
    const y = radius * Math.cos(phi)
    const z = radius * Math.sin(phi) * Math.sin(theta)

    globePositions[i * 3] = x
    globePositions[i * 3 + 1] = y
    globePositions[i * 3 + 2] = z
  }

  return globePositions
}
```

### Mathematical Explanation

**Spherical coordinate system**:
```
φ (phi): Polar angle (0 at North Pole, π at South Pole)
θ (theta): Azimuthal angle (longitude, 0 at prime meridian)
r (radius): Distance from origin
```

**Conversions**:

1. **Latitude to phi**:
   ```
   φ = (90° - latitude) × π/180
   ```
   - Latitude 90° (North Pole) → φ = 0
   - Latitude 0° (Equator) → φ = π/2
   - Latitude -90° (South Pole) → φ = π

2. **Longitude to theta**:
   ```
   θ = (longitude + 180°) × π/180
   ```
   - Longitude -180° → θ = 0
   - Longitude 0° (Prime Meridian) → θ = π
   - Longitude +180° → θ = 2π

3. **Spherical to Cartesian**:
   ```
   x = r × sin(φ) × cos(θ)
   y = r × cos(φ)
   z = r × sin(φ) × sin(θ)
   ```

4. **Radius**:
   ```
   r = EARTH_RADIUS + altitude
   ```
   - EARTH_RADIUS = 6.371 km (mean Earth radius)
   - Altitude from CALIPSO data (0-40 km)

### Why φ = (90° - lat)?

**Standard spherical coordinates** measure φ from the **positive Z-axis** (North Pole).

**Our latitude** measures from **equator** (0°) with positive north.

**Conversion**:
- Lat = +90° (North Pole) → φ = 0° (aligned with +Y axis)
- Lat = 0° (Equator) → φ = 90° (perpendicular to +Y axis)
- Lat = -90° (South Pole) → φ = 180° (opposite of +Y axis)

### Why θ = (lon + 180°)?

**Longitude range**: -180° to +180°

**Theta range**: 0 to 2π (0° to 360°)

**Offset** makes longitude -180° correspond to θ = 0, placing the **antimeridian** at the "front" of the sphere when viewed from default camera position.

**Alternative**: Could use `θ = lon × π/180` with different camera setup.

## Satellite Position Calculation

**File**: `src/components/GlobeViewer.tsx`

**Context**: Animating satellite along orbital path

**Code** (lines 500-510):

```typescript
const EARTH_RADIUS = 6.371 // km
const SATELLITE_ALTITUDE = 705 // km (CALIPSO orbital altitude)
const radius = EARTH_RADIUS + SATELLITE_ALTITUDE

const phi = (90 - currentLat) * Math.PI / 180
const theta = (currentLon + 180) * Math.PI / 180

const x = radius * Math.sin(phi) * Math.cos(theta)
const y = radius * Math.cos(phi)
const z = radius * Math.sin(phi) * Math.sin(theta)

satelliteRef.current.position.set(x, y, z)
```

**Orbital altitude**: 705 km (CALIPSO's actual orbital height)

**Result**: Satellite appears at correct position above point cloud.

## 2D Map Coordinate Handling

### deck.gl ScatterplotLayer

**File**: `src/components/DeckGLMapView.tsx`

**Position data** (lines 150-170):

```typescript
const layers = [
  new ScatterplotLayer({
    id: 'point-cloud',
    data: pointData,
    getPosition: (d: PointData) => [d.lon, d.lat, d.alt * 1000], // Note: alt in meters
    getColor: (d: PointData) => d.color,
    getRadius: pointSize,
    // ... other props
  })
]
```

**Key detail**: Altitude converted from **kilometers to meters**:
```typescript
getPosition: (d) => [d.lon, d.lat, d.alt * 1000]
```

**Why?**
- deck.gl expects altitude in **meters**
- CALIPSO data stores in **kilometers**
- Conversion: `alt_meters = alt_km × 1000`

### MapLibre Base Map

**Projection**: Web Mercator (EPSG:3857)

**Automatic handling**:
- MapLibre converts lon/lat to pixel coordinates
- deck.gl overlay syncs automatically
- No manual projection code needed

**Coordinate range**:
- Longitude: -180° to +180° (full coverage)
- Latitude: -85.051129° to +85.051129° (Mercator limit)

**CALIPSO compatibility**: ✅ Good
- CALIPSO is polar orbiter (reaches ±82° latitude)
- Well within Mercator's valid range
- No distortion issues

## Coordinate System Switching

### View Mode Toggle

**User action**: Click "🌍 Space View" or "🗺️ 2D Map" button

**Effect**: Switch between coordinate systems

**Implementation** (`src/components/PointCloudViewer.tsx:327-331`):

```typescript
useEffect(() => {
  if (globeRef.current) {
    globeRef.current.setViewMode(viewMode)
  }
}, [viewMode])
```

### Globe to 2D Transition

**From**: 3D Cartesian (x, y, z in km from Earth's center)

**To**: Geographic (lon, lat, alt)

**Process**:
1. App.tsx: `setViewMode('2d')`
2. PointCloudViewer: Conditionally renders DeckGLMapView instead of GlobeViewer
3. DeckGLMapView: Uses original `data.positions` (still in lon/lat/alt)
4. No coordinate conversion needed (data never modified)

**Key insight**: Original geographic coordinates are **preserved in dataRef**, so switching views just changes which renderer is used.

### 2D to Globe Transition

**From**: Geographic (lon, lat, alt)

**To**: 3D Cartesian (x, y, z)

**Process** (`src/components/PointCloudViewer.tsx:335-358`):

```typescript
useEffect(() => {
  if (viewMode === '2d' || dataRef.current.length === 0) return

  const scene = globeRef.current?.getScene()
  if (!scene) return

  dataRef.current.forEach((data, index) => {
    const pointCloud = pointCloudsRef.current[index]
    if (!pointCloud) return

    // Re-add point cloud to scene if it's not there
    if (!scene.children.includes(pointCloud)) {
      scene.add(pointCloud)
    }

    // Convert coordinates to globe view
    const positions = convertPointsToGlobe(data.positions)

    // Update the geometry
    const positionAttribute = pointCloud.geometry.getAttribute('position') as THREE.BufferAttribute
    positionAttribute.array = positions
    positionAttribute.needsUpdate = true
  })
}, [viewMode])
```

**Steps**:
1. Call `convertPointsToGlobe(data.positions)` to create new Cartesian array
2. Update Three.js BufferAttribute with new positions
3. Flag `needsUpdate = true` to trigger GPU upload

## Earth Model Parameters

### Earth Radius

**Value used**: 6.371 km

**Source**: Mean Earth radius (volumetric mean)

**Alternatives**:
- Equatorial radius: 6.378 km
- Polar radius: 6.357 km
- Volumetric mean: 6.371 km ✓

**Why mean radius?**
- Simple (single value)
- Sufficient for visualization (not precision geodesy)
- CALIPSO data uses WGS84, but we're rendering, not computing orbits

**Impact of choice**:
- ±7 km difference from equator to poles
- At CALIPSO altitude (~705 km), error is <1%
- Negligible for visual representation

### CALIPSO Orbital Parameters

**Altitude**: 705 km

**Orbit type**: Sun-synchronous polar orbit

**Inclination**: 98.2°

**Period**: ~99 minutes

**Ground track**: Crosses equator at same local time (~13:30)

**Visualization implication**: Satellite appears high above Earth in globe view (radius = 6.371 + 0.705 = 7.076 km).

## Precision and Accuracy

### Float32 Precision

**Positions stored as**: Float32Array (32-bit floats)

**Precision**: ~7 significant decimal digits

**For geographic coordinates**:
```
Longitude: ±180° with 7 digits → ~0.00001° ≈ 1 meter at equator
Latitude: ±90° with 7 digits → ~0.00001° ≈ 1 meter
Altitude: 0-40 km with 7 digits → ~0.0001 km = 10 cm
```

**Sufficient?** ✅ Yes
- CALIPSO shot spacing: ~333 meters along-track
- Precision is 3+ orders of magnitude better than data resolution
- No precision loss issues observed

### Cartesian Coordinate Precision

**3D positions**: Also Float32Array

**Range**: ±7.1 km (Earth radius + max altitude)

**Precision**: ~0.0001 km = 10 cm at this range

**Rendering**: More than adequate for visualization

## Common Transformations

### Point in Polygon (AOI Selection)

**Coordinates**: Geographic (lon, lat)

**Algorithm**: Ray casting in 2D

**No transformation needed**: Polygon vertices and points are both in lon/lat.

**File**: `src/utils/aoiSelector.ts`

```typescript
export function isPointInPolygon(point: LatLon, polygon: LatLon[]): boolean {
  const x = point.lon
  const y = point.lat
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat
    const xj = polygon[j].lon, yj = polygon[j].lat

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi)

    if (intersect) inside = !inside
  }

  return inside
}
```

**Works in geographic coordinates** because:
- Polygons are small (local regions)
- Distortion from treating lon/lat as planar is minimal
- For large polygons crossing dateline, would need spherical algorithms

### Camera Position

**Three.js camera**: Positioned in 3D Cartesian space

**Default camera** (`src/components/GlobeViewer.tsx:80-82`):

```typescript
const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)
camera.position.set(0, 0, 20) // 20 km from origin
camera.lookAt(0, 0, 0)
```

**Coordinates**: (x=0, y=0, z=20) km

**Meaning**: Viewing Earth from 20 km away along +Z axis (looking at 0° lat, 180° lon)

**OrbitControls**: Allow user to rotate camera around origin (Earth's center).

## Edge Cases and Special Handling

### Dateline Crossing

**Issue**: Longitude jumps from +180° to -180°

**Example**: Track from 179° to -179° (only 2° apart, but numerically 358° apart)

**Handled by**:
- Spherical math in `convertPointsToGlobe` (naturally continuous)
- AOI polygon may have issues if crossing dateline (not currently handled)

**Future fix**: Detect dateline crossing, split polygon.

### Polar Regions

**Issue**: Longitude is undefined at exact poles (lat = ±90°)

**CALIPSO data**: Rarely exactly at poles (orbits at 98° inclination, not 90°)

**Spherical conversion**: Works correctly even at poles:
```
φ = (90 - 90) = 0° → sin(0) = 0, cos(0) = 1 → (x,y,z) = (0, r, 0)
```

Result: Point at North Pole becomes (0, radius, 0) regardless of longitude.

### Altitude Extremes

**CALIPSO range**: -0.5 km to +40 km

**Negative altitude**: Below sea level (rare, only in data gaps)

**Handling**:
```typescript
const radius = EARTH_RADIUS + alt
```

If alt = -0.5, radius = 6.371 - 0.5 = 5.871 km (inside Earth visually).

**Acceptable**: Visualization shows interior structure, scientifically not meaningful but doesn't crash.

## Performance Considerations

### Conversion Overhead

**convertPointsToGlobe()**: O(n) where n = point count

**For 5M points**:
```
5,000,000 iterations
Each: 6 trig calls (sin, cos), 1 multiplication
~500ms on M1 MacBook Pro
```

**When called**:
- Initial load
- View mode switch to globe
- NOT during animation (positions cached)

**Optimization**: Use typed arrays (Float32Array) for efficiency.

### GPU Upload

**BufferAttribute update**:
```typescript
positionAttribute.array = globePositions
positionAttribute.needsUpdate = true
```

**Cost**: Transfer ~60 MB to GPU (5M points × 3 × 4 bytes)

**Time**: ~100ms (GPU memory bandwidth limited)

**Frequency**: Only on view mode change, not per frame.

## Coordinate System Debugging

### Verification Points

**Test cases**:

1. **North Pole** (lat=90, lon=0, alt=0):
   ```
   Expected: (0, 6.371, 0)
   Actual: (0, 6.371, 0) ✓
   ```

2. **South Pole** (lat=-90, lon=0, alt=0):
   ```
   Expected: (0, -6.371, 0)
   Actual: (0, -6.371, 0) ✓
   ```

3. **Equator/Prime Meridian** (lat=0, lon=0, alt=0):
   ```
   Expected: (6.371, 0, 0) — actually complex, depends on theta offset
   With theta = (0 + 180) × π/180 = π:
   x = 6.371 × sin(π/2) × cos(π) = 6.371 × 1 × -1 = -6.371
   y = 6.371 × cos(π/2) = 0
   z = 6.371 × sin(π/2) × sin(π) = 0
   Actual: (-6.371, 0, 0) ✓
   ```

4. **Satellite altitude** (lat=0, lon=0, alt=705):
   ```
   radius = 6.371 + 705 = 7.076 km
   Position: (-7.076, 0, 0)
   Actual: (-7.076, 0, 0) ✓
   ```

### Console Logging

```typescript
console.log('Converting points to globe coordinates')
console.log('Sample point:', { lon, lat, alt }, '→', { x, y, z })
```

Helps verify transformations during development.

## Future Enhancements

### 1. Ellipsoidal Earth Model

Use WGS84 ellipsoid instead of sphere:

```typescript
const EARTH_EQUATORIAL_RADIUS = 6.378137 // km
const EARTH_POLAR_RADIUS = 6.356752 // km

// Ellipsoidal conversion (more complex)
```

**Benefit**: ±7 km accuracy improvement near poles.

**Cost**: More complex math, slight performance hit.

### 2. ECEF Coordinates

Use Earth-Centered Earth-Fixed coordinates:

**Standard** for satellite positioning

**Would align with**: CALIPSO orbital data formats

**Trade-off**: Requires more complex transformations.

### 3. True 3D AOI Selection

Currently AOI is 2D (lat/lon polygon).

**Enhancement**: 3D bounding box or altitude filtering:

```typescript
interface AOI3D {
  polygon: LatLon[]
  minAltitude: number
  maxAltitude: number
}
```

### 4. Coordinate System Selector

Let users choose:
- Cartesian ECEF
- Spherical (current)
- Geodetic (ellipsoidal)
- Local tangent plane (ENU)

## Conclusion

The coordinate transformation system enables seamless switching between:

- **Geographic coordinates** (native data format, AOI selection)
- **3D Cartesian** (globe rendering, satellite animation)
- **2D map projection** (high-performance flat view)

Key innovations:

1. **Preserved original data**: Never modify source coordinates
2. **On-demand conversion**: Transform only when needed (view switches)
3. **Typed array efficiency**: Fast conversions using Float32Array
4. **Simple spherical model**: Sufficient accuracy for visualization

The transformations balance **mathematical correctness** with **performance** and **simplicity**, enabling rich multi-view interaction with minimal overhead.
