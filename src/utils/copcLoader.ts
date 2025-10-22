import * as THREE from 'three'
import * as LazPerfModule from 'laz-perf'
import { applyColormap, Colormap } from './colormaps'

/**
 * Convert TAI time (seconds since 1993-01-01 00:00:00 UTC) to JavaScript Date
 * TAI = International Atomic Time, used by CALIPSO satellite
 */
export function taiToDate(taiSeconds: number): Date {
  // TAI epoch: January 1, 1993, 00:00:00 UTC
  const taiEpoch = new Date('1993-01-01T00:00:00.000Z').getTime() // milliseconds

  // Convert TAI seconds to milliseconds and add to epoch
  const utcMilliseconds = taiEpoch + (taiSeconds * 1000)

  return new Date(utcMilliseconds)
}

/**
 * Format TAI time as readable string
 */
export function formatTaiTime(taiSeconds: number): string {
  const date = taiToDate(taiSeconds)

  // Format as: YYYY-MM-DD HH:MM:SS.sss UTC
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} UTC`
}

export interface PointCloudData {
  positions: Float32Array
  colors: Uint8Array
  intensities: Uint16Array
  classifications: Uint8Array
  count: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
  firstPoint?: {
    lon: number
    lat: number
    alt: number
    gpsTime: number
  }
  lastPoint?: {
    lon: number
    lat: number
    alt: number
    gpsTime: number
  }
}

// LAZ header parsing helpers
function readLASHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer)

  // Read LAS header
  const signature = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  )

  if (signature !== 'LASF') {
    throw new Error('Invalid LAS file - signature mismatch')
  }

  const pointDataOffset = view.getUint32(96, true)
  const pointDataRecordFormat = view.getUint8(104)
  const pointDataRecordLength = view.getUint16(105, true)
  const pointCount = view.getUint32(107, true) ||  view.getUint32(247, true) // Legacy or extended

  const scaleX = view.getFloat64(131, true)
  const scaleY = view.getFloat64(139, true)
  const scaleZ = view.getFloat64(147, true)

  const offsetX = view.getFloat64(155, true)
  const offsetY = view.getFloat64(163, true)
  const offsetZ = view.getFloat64(171, true)

  const maxX = view.getFloat64(179, true)
  const minX = view.getFloat64(187, true)
  const maxY = view.getFloat64(195, true)
  const minY = view.getFloat64(203, true)
  const maxZ = view.getFloat64(211, true)
  const minZ = view.getFloat64(219, true)

  return {
    pointDataOffset,
    pointDataRecordFormat,
    pointDataRecordLength,
    pointCount,
    scale: { x: scaleX, y: scaleY, z: scaleZ },
    offset: { x: offsetX, y: offsetY, z: offsetZ },
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  }
}

// Parse point format 6 (LAS 1.4)
function parsePointFormat6(
  pointBuffer: Uint8Array,
  scale: { x: number, y: number, z: number },
  offset: { x: number, y: number, z: number },
  index: number // Point index for debugging
) {
  const view = new DataView(pointBuffer.buffer, pointBuffer.byteOffset)

  // Point Format 6: X(4) Y(4) Z(4) Intensity(2) Flags(1) Classification(1)
  //                  ScanAngle(2) UserData(1) PointSourceID(2) GPSTime(8)
  //                  Red(2) Green(2) Blue(2) = 30 bytes minimum

  const x = view.getInt32(0, true) * scale.x + offset.x
  const y = view.getInt32(4, true) * scale.y + offset.y
  const z = view.getInt32(8, true) * scale.z + offset.z
  const intensity = view.getUint16(12, true)
  const classification = view.getUint8(15)

  // Try reading GPS time at offset 22 instead of 21
  // Point Source ID is at 19-20 (2 bytes), so next field starts at 21
  // But maybe there's alignment padding?
  let gpsTime = view.getFloat64(22, true)

  // Check if GPS time seems valid (should be positive and reasonable)
  // GPS time in LAS files is typically GPS week seconds (0-604800)
  if (gpsTime < 0 || gpsTime > 1e15 || !isFinite(gpsTime)) {
    // Try offset 21
    gpsTime = view.getFloat64(21, true)

    // If still invalid, try offset 20
    if (gpsTime < 0 || gpsTime > 1e15 || !isFinite(gpsTime)) {
      gpsTime = view.getFloat64(20, true)
    }

    // If all attempts fail, use point index as fallback
    if (gpsTime < 0 || gpsTime > 1e15 || !isFinite(gpsTime)) {
      gpsTime = index // Use point index as sequential time
    }
  }

  return { x, y, z, intensity, classification, gpsTime }
}

/**
 * Load a LAZ/COPC file and extract point cloud data using laz-perf
 */
export async function loadCOPCFile(url: string, onProgress?: (progress: number) => void): Promise<PointCloudData> {
  try {
    console.log(`Loading LAZ file: ${url}`)

    // Fetch the file
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    console.log(`Fetched ${arrayBuffer.byteLength} bytes`)

    if (onProgress) onProgress(10)

    // Parse LAS header
    const header = readLASHeader(arrayBuffer)
    console.log('LAS Header:', header)
    console.log(`Point format: ${header.pointDataRecordFormat}, Count: ${header.pointCount}`)

    if (onProgress) onProgress(20)

    // Initialize laz-perf WASM module
    console.log('Initializing laz-perf...')
    const createLazPerf = LazPerfModule.createLazPerf || LazPerfModule.create || LazPerfModule.default
    const lazPerf = await createLazPerf({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/laz-perf.wasm'
        }
        return path
      }
    })
    console.log('laz-perf initialized')

    if (onProgress) onProgress(30)

    // Allocate memory in WASM heap for the file
    const fileSize = arrayBuffer.byteLength
    const filePtr = lazPerf._malloc(fileSize)
    if (!filePtr) {
      throw new Error('Failed to allocate memory for file')
    }

    // Copy file data to WASM heap
    lazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr)
    console.log(`Copied file to WASM heap at ${filePtr}`)

    if (onProgress) onProgress(40)

    // Create LASZip decoder
    const laszip = new lazPerf.LASZip()
    laszip.open(filePtr, fileSize)

    const pointCount = laszip.getCount()
    const pointLength = laszip.getPointLength()
    const pointFormat = laszip.getPointFormat()

    console.log(`LASZip opened: ${pointCount} points, format ${pointFormat}, ${pointLength} bytes/point`)

    if (onProgress) onProgress(50)

    // Allocate buffer for a single point
    const pointPtr = lazPerf._malloc(pointLength)
    if (!pointPtr) {
      throw new Error('Failed to allocate memory for point buffer')
    }

    // Arrays to store point data
    const positions: number[] = []
    const intensities: number[] = []
    const classifications: number[] = []
    const gpsTimes: number[] = []

    const bounds = {
      min: [Infinity, Infinity, Infinity] as [number, number, number],
      max: [-Infinity, -Infinity, -Infinity] as [number, number, number]
    }

    // Variables to store first and last point info (will be set after sorting)
    let firstPoint: { lon: number, lat: number, alt: number, gpsTime: number } | undefined
    let lastPoint: { lon: number, lat: number, alt: number, gpsTime: number } | undefined

    // Determine decimation factor for large files
    // Target: reduce to ~5M points for sorting performance
    const TARGET_POINT_COUNT = 5_000_000
    let decimationFactor = 1
    if (pointCount > TARGET_POINT_COUNT) {
      decimationFactor = Math.ceil(pointCount / TARGET_POINT_COUNT)
      console.log(`Large file detected. Decimating by factor of ${decimationFactor} (keeping every ${decimationFactor}th point)`)
      console.log(`Target points: ~${Math.floor(pointCount / decimationFactor).toLocaleString()}`)
    }

    // Read all points (with optional decimation)
    console.log(`Reading ${pointCount} points...`)
    let actualPointsRead = 0
    for (let i = 0; i < pointCount; i++) {
      // Get point from LAZ
      laszip.getPoint(pointPtr)

      // Skip points based on decimation factor
      if (decimationFactor > 1 && i % decimationFactor !== 0) {
        continue
      }

      // Create a view of the point data
      const pointBuffer = new Uint8Array(
        lazPerf.HEAPU8.buffer,
        pointPtr,
        pointLength
      )

      // Parse point
      const point = parsePointFormat6(pointBuffer, header.scale, header.offset, i)

      positions.push(point.x, point.y, point.z)
      intensities.push(point.intensity)
      classifications.push(point.classification)
      gpsTimes.push(point.gpsTime)
      actualPointsRead++

      // Update bounds
      bounds.min[0] = Math.min(bounds.min[0], point.x)
      bounds.min[1] = Math.min(bounds.min[1], point.y)
      bounds.min[2] = Math.min(bounds.min[2], point.z)
      bounds.max[0] = Math.max(bounds.max[0], point.x)
      bounds.max[1] = Math.max(bounds.max[1], point.y)
      bounds.max[2] = Math.max(bounds.max[2], point.z)

      // Report progress every 10000 points
      if (i % 10000 === 0 && onProgress) {
        const progress = 50 + (i / pointCount) * 45
        onProgress(progress)
      }
    }

    console.log(`Read ${actualPointsRead.toLocaleString()} points (${decimationFactor > 1 ? `decimated from ${pointCount.toLocaleString()}` : 'no decimation'})`)

    // Find min/max GPS times without spread operator (avoids stack overflow)
    let minGpsTime = Infinity
    let maxGpsTime = -Infinity
    for (let i = 0; i < gpsTimes.length; i++) {
      minGpsTime = Math.min(minGpsTime, gpsTimes[i])
      maxGpsTime = Math.max(maxGpsTime, gpsTimes[i])
    }
    console.log(`GPS time range before sorting: ${minGpsTime} to ${maxGpsTime}`)

    // Sort points by x,y (lat/lon) position groups, keeping all Z values together
    console.log('Grouping and sorting by x,y positions...')

    // Group points by x,y coordinates (each x,y represents a vertical laser shot)
    interface XYGroup {
      x: number
      y: number
      gpsTime: number
      indices: number[]
    }

    const xyMap = new Map<string, XYGroup>()

    for (let i = 0; i < actualPointsRead; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const key = `${x.toFixed(6)},${y.toFixed(6)}`

      if (!xyMap.has(key)) {
        xyMap.set(key, {
          x,
          y,
          gpsTime: gpsTimes[i],
          indices: []
        })
      }
      xyMap.get(key)!.indices.push(i)
    }

    console.log(`Found ${xyMap.size} unique x,y positions`)

    // Sort x,y groups by GPS time
    const sortedGroups = Array.from(xyMap.values()).sort((a, b) => a.gpsTime - b.gpsTime)

    // Reorder all arrays based on sorted x,y groups
    const sortedPositions: number[] = []
    const sortedIntensities: number[] = []
    const sortedClassifications: number[] = []
    const sortedGpsTimes: number[] = []

    for (const group of sortedGroups) {
      // Add all points (all Z values) for this x,y position
      for (const idx of group.indices) {
        sortedPositions.push(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2])
        sortedIntensities.push(intensities[idx])
        sortedClassifications.push(classifications[idx])
        sortedGpsTimes.push(gpsTimes[idx])
      }
    }

    // Note: We'll use the sorted arrays directly instead of replacing the originals
    // to avoid stack overflow with large arrays

    // Set first and last points (now chronologically ordered)
    firstPoint = {
      lon: sortedPositions[0],
      lat: sortedPositions[1],
      alt: sortedPositions[2],
      gpsTime: sortedGpsTimes[0]
    }

    lastPoint = {
      lon: sortedPositions[(actualPointsRead - 1) * 3],
      lat: sortedPositions[(actualPointsRead - 1) * 3 + 1],
      alt: sortedPositions[(actualPointsRead - 1) * 3 + 2],
      gpsTime: sortedGpsTimes[actualPointsRead - 1]
    }

    console.log(`GPS time range after sorting: ${sortedGpsTimes[0]} to ${sortedGpsTimes[actualPointsRead - 1]}`)
    console.log('First point (earliest):', firstPoint)
    console.log('Last point (latest):', lastPoint)

    if (onProgress) onProgress(95)

    // Cleanup
    lazPerf._free(pointPtr)
    lazPerf._free(filePtr)
    laszip.delete()

    console.log(`Loaded and sorted ${actualPointsRead.toLocaleString()} points`)
    console.log(`Bounds:`, bounds)

    if (onProgress) onProgress(100)

    // Convert sorted arrays to typed arrays
    const positionsArray = new Float32Array(sortedPositions)
    const intensitiesArray = new Uint16Array(sortedIntensities)
    const classificationsArray = new Uint8Array(sortedClassifications)
    const colors = new Uint8Array(actualPointsRead * 3)

    return {
      positions: positionsArray,
      colors,
      intensities: intensitiesArray,
      classifications: classificationsArray,
      count: actualPointsRead,
      bounds,
      firstPoint,
      lastPoint
    }
  } catch (error) {
    console.error('Error loading LAZ file:', error)
    throw new Error(`Failed to load LAZ file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Compute colors for points based on elevation
 */
export function computeElevationColors(
  positions: Float32Array,
  colors: Uint8Array,
  minZ: number,
  maxZ: number,
  colormap: Colormap = 'viridis'
) {
  const count = positions.length / 3
  const range = maxZ - minZ

  for (let i = 0; i < count; i++) {
    const z = positions[i * 3 + 2]
    const t = range > 0 ? (z - minZ) / range : 0.5

    const [r, g, b] = applyColormap(t, colormap)

    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
}

/**
 * Compute colors for points based on intensity
 */
export function computeIntensityColors(
  intensities: Uint16Array,
  colors: Uint8Array,
  minIntensity?: number,
  maxIntensity?: number,
  colormap: Colormap = 'viridis'
) {
  const count = intensities.length

  // Use provided min/max or compute from data
  if (minIntensity === undefined || maxIntensity === undefined) {
    minIntensity = Infinity
    maxIntensity = -Infinity
    for (let i = 0; i < count; i++) {
      minIntensity = Math.min(minIntensity, intensities[i])
      maxIntensity = Math.max(maxIntensity, intensities[i])
    }
  }

  const range = maxIntensity - minIntensity

  for (let i = 0; i < count; i++) {
    const intensity = intensities[i]
    const normalized = range > 0 ? (intensity - minIntensity) / range : 0.5

    const [r, g, b] = applyColormap(normalized, colormap)

    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
}

/**
 * Compute colors for points based on classification
 */
export function computeClassificationColors(
  classifications: Uint8Array,
  colors: Uint8Array
) {
  // Standard LAS classification colors
  const classColors: Record<number, [number, number, number]> = {
    0: [128, 128, 128], // Unclassified - gray
    1: [200, 200, 200], // Unclassified - light gray
    2: [160, 82, 45],   // Ground - brown
    3: [34, 139, 34],   // Low Vegetation - green
    4: [50, 205, 50],   // Medium Vegetation - lime green
    5: [0, 128, 0],     // High Vegetation - dark green
    6: [255, 0, 0],     // Building - red
    7: [128, 128, 128], // Noise - gray
    9: [0, 191, 255],   // Water - deep sky blue
    17: [255, 192, 203] // Bridge - pink
  }

  const count = classifications.length
  for (let i = 0; i < count; i++) {
    const classification = classifications[i]
    const color = classColors[classification] || [128, 128, 128]

    colors[i * 3] = color[0]
    colors[i * 3 + 1] = color[1]
    colors[i * 3 + 2] = color[2]
  }
}
