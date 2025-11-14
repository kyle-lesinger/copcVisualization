/**
 * Potree Format Loader
 *
 * Loads Potree 2.0 format point cloud data
 * Uses @loaders.gl/potree for efficient loading
 */

import { PotreeLoader } from '@loaders.gl/potree'
import { load } from '@loaders.gl/core'

// Re-use the existing PointCloudData interface from copcLoader
export interface PointCloudData {
  positions: Float32Array
  intensities: Uint16Array
  classifications: Uint8Array
  gpsTimes: Float64Array
  colors: Uint8Array // RGB colors for rendering
  pointCount: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

/**
 * Potree metadata interface matching Potree 2.0 format
 */
export interface PotreeMetadata {
  version: string
  name: string
  description: string
  points: number
  projection: string
  hierarchy: {
    firstChunkSize: number
    stepSize: number
    depth: number
  }
  offset: [number, number, number]
  scale: [number, number, number]
  spacing: number
  boundingBox: {
    min: [number, number, number]
    max: [number, number, number]
  }
  encoding: string
  attributes: PotreeAttribute[]
}

export interface PotreeAttribute {
  name: string
  description: string
  size: number
  numElements: number
  elementSize: number
  type: string
  min: number[]
  max: number[]
  scale: number[]
  offset: number[]
  histogram?: number[]
}

/**
 * Load Potree metadata.json
 *
 * @param baseUrl - Base URL of the Potree directory
 * @returns Promise resolving to Potree metadata
 */
export async function loadPotreeMetadata(baseUrl: string): Promise<PotreeMetadata> {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  // Try flat structure first (metadata.json in root)
  let metadataUrl = `${normalizedBaseUrl}metadata.json`
  console.log(`[PotreeLoader] Trying flat structure: ${metadataUrl}`)

  let response = await fetch(metadataUrl)

  // If flat structure fails, try standard Potree 2.0 structure
  if (!response.ok) {
    console.log(`[PotreeLoader] Flat structure failed, trying standard Potree 2.0 structure`)
    metadataUrl = `${normalizedBaseUrl}pointclouds/index/metadata.json`
    console.log(`[PotreeLoader] Loading metadata from: ${metadataUrl}`)
    response = await fetch(metadataUrl)
  } else {
    console.log(`[PotreeLoader] ✓ Found metadata in flat structure`)
  }

  try {
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.statusText}`)
    }

    const metadata: PotreeMetadata = await response.json()

    // WORKAROUND: PotreeConverter sometimes generates incorrect top-level boundingBox
    // Use the position attribute bounds instead (they're always correct)
    const positionAttr = metadata.attributes.find(attr => attr.name === 'position')
    if (positionAttr && positionAttr.min && positionAttr.max) {
      console.warn('[PotreeLoader] Using position attribute bounds instead of top-level boundingBox')
      console.warn('[PotreeLoader] Original bounds:', metadata.boundingBox)
      console.warn('[PotreeLoader] Corrected bounds:', {
        min: positionAttr.min,
        max: positionAttr.max
      })

      // Override the incorrect boundingBox with correct position bounds
      metadata.boundingBox = {
        min: [positionAttr.min[0], positionAttr.min[1], positionAttr.min[2]],
        max: [positionAttr.max[0], positionAttr.max[1], positionAttr.max[2]]
      }
    }

    console.log(`[PotreeLoader] Metadata loaded:`, {
      version: metadata.version,
      points: metadata.points,
      depth: metadata.hierarchy.depth,
      encoding: metadata.encoding,
      bounds: metadata.boundingBox
    })

    return metadata
  } catch (error) {
    console.error('[PotreeLoader] Failed to load metadata:', error)
    throw error
  }
}

/**
 * Load full Potree point cloud (for 2D mode)
 * Note: This loads ALL points - use with caution for large datasets
 *
 * @param baseUrl - Base URL of the Potree directory
 * @param options - Optional loading options
 * @returns Promise resolving to PointCloudData
 */
export async function loadPotreeData(
  baseUrl: string,
  options?: {
    onProgress?: (percent: number) => void
    spatialBounds?: {
      minLon: number
      maxLon: number
      minLat: number
      maxLat: number
      minAlt: number
      maxAlt: number
    }
  }
): Promise<PointCloudData> {
  console.log(`[PotreeLoader] Loading Potree data from: ${baseUrl}`)

  // Ensure baseUrl ends with slash
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  try {
    // Load metadata first
    const metadata = await loadPotreeMetadata(baseUrl)

    // Try flat structure first (octree.bin in root)
    let octreeUrl = `${normalizedBaseUrl}octree.bin`
    console.log(`[PotreeLoader] Trying flat structure octree: ${octreeUrl}`)

    let response = await fetch(octreeUrl)

    // If flat structure fails, try standard Potree 2.0 structure
    if (!response.ok) {
      console.log(`[PotreeLoader] Flat structure failed, trying standard Potree 2.0 structure`)
      octreeUrl = `${normalizedBaseUrl}pointclouds/index/octree.bin`
      console.log(`[PotreeLoader] Loading octree from: ${octreeUrl}`)
      response = await fetch(octreeUrl)
    } else {
      console.log(`[PotreeLoader] ✓ Found octree.bin in flat structure`)
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch octree: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    console.log(`[PotreeLoader] Loaded octree.bin: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`)

    // Try parallel parsing first, fall back to single-threaded if it fails
    let pointData: PointCloudData
    try {
      pointData = await parsePotreePointsParallel(arrayBuffer, metadata, options)
    } catch (error) {
      console.warn('[PotreeLoader] ⚠️  Parallel parsing failed (likely out of memory), falling back to single-threaded parsing')
      console.warn('[PotreeLoader] Error:', error)
      pointData = parsePotreePoints(arrayBuffer, metadata, options)
    }

    console.log(`[PotreeLoader] Parsed ${pointData.pointCount} points`)
    console.log(`[PotreeLoader] Bounds:`, pointData.bounds)

    return pointData
  } catch (error) {
    console.error('[PotreeLoader] Failed to load Potree data:', error)
    throw error
  }
}

/**
 * Parse Potree binary point data
 *
 * @param buffer - ArrayBuffer containing point data
 * @param metadata - Potree metadata
 * @param options - Optional filtering options
 * @returns PointCloudData
 */
function parsePotreePoints(
  buffer: ArrayBuffer,
  metadata: PotreeMetadata,
  options?: {
    spatialBounds?: {
      minLon: number
      maxLon: number
      minLat: number
      maxLat: number
      minAlt: number
      maxAlt: number
    }
  }
): PointCloudData {
  // Calculate point stride (total bytes per point)
  const stride = metadata.attributes.reduce((sum, attr) => sum + attr.size, 0)

  // Calculate actual point count from buffer size
  const maxPoints = Math.floor(buffer.byteLength / stride)
  console.log(`[PotreeLoader] Parsing ${maxPoints} points from ${buffer.byteLength} byte buffer (stride: ${stride} bytes)`)

  // Find attribute offsets
  let offset = 0
  const attributeOffsets: Record<string, number> = {}
  for (const attr of metadata.attributes) {
    attributeOffsets[attr.name] = offset
    offset += attr.size
  }
  const positions = new Float32Array(maxPoints * 3)
  const intensities = new Uint16Array(maxPoints)
  const classifications = new Uint8Array(maxPoints)
  const gpsTimes = new Float64Array(maxPoints)

  const view = new DataView(buffer)
  let validPoints = 0

  // Bounds tracking for ACTUAL data (after parsing)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  // Track data distribution (sample every 1000th point)
  const sampleInterval = Math.max(1, Math.floor(maxPoints / 1000))
  const dataSamples: { x: number, y: number, z: number }[] = []

  // Parse each point
  for (let i = 0; i < maxPoints; i++) {
    const pointOffset = i * stride

    // Read position (int32 x, y, z)
    const posOffset = pointOffset + attributeOffsets['position']
    const x = view.getInt32(posOffset, true) * metadata.scale[0] + metadata.offset[0]
    const y = view.getInt32(posOffset + 4, true) * metadata.scale[1] + metadata.offset[1]
    const z = view.getInt32(posOffset + 8, true) * metadata.scale[2] + metadata.offset[2]

    // Sample data distribution
    if (i % sampleInterval === 0) {
      dataSamples.push({ x, y, z })
    }

    // Debug: log first few points
    if (i < 3) {
      console.log(`[PotreeLoader] Point ${i}: lon=${x.toFixed(2)}°, lat=${y.toFixed(2)}°, alt=${z.toFixed(2)} km`)
    }

    // Apply spatial filtering if provided
    if (options?.spatialBounds) {
      const bounds = options.spatialBounds
      if (x < bounds.minLon || x > bounds.maxLon ||
          y < bounds.minLat || y > bounds.maxLat ||
          z < bounds.minAlt || z > bounds.maxAlt) {
        continue // Skip this point - outside bounds
      }
    }

    // Read intensity (uint16)
    const intensityOffset = pointOffset + attributeOffsets['intensity']
    const intensity = view.getUint16(intensityOffset, true)

    // Read classification (uint8)
    const classificationOffset = pointOffset + attributeOffsets['classification']
    const classification = view.getUint8(classificationOffset)

    // Read GPS time (double)
    const gpsTimeOffset = pointOffset + attributeOffsets['gps-time']
    const gpsTime = view.getFloat64(gpsTimeOffset, true)

    // Store in output arrays
    positions[validPoints * 3] = x
    positions[validPoints * 3 + 1] = y
    positions[validPoints * 3 + 2] = z
    intensities[validPoints] = intensity
    classifications[validPoints] = classification
    gpsTimes[validPoints] = gpsTime

    // Update bounds
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)

    validPoints++
  }

  // Analyze data distribution from samples
  if (dataSamples.length > 0) {
    const sampleMinX = Math.min(...dataSamples.map(p => p.x))
    const sampleMaxX = Math.max(...dataSamples.map(p => p.x))
    const sampleMinY = Math.min(...dataSamples.map(p => p.y))
    const sampleMaxY = Math.max(...dataSamples.map(p => p.y))
    const sampleMinZ = Math.min(...dataSamples.map(p => p.z))
    const sampleMaxZ = Math.max(...dataSamples.map(p => p.z))

    console.log(`\n[PotreeLoader] 📊 ACTUAL DATA DISTRIBUTION (from ${dataSamples.length} samples):`)
    console.log(`  Longitude: ${sampleMinX.toFixed(2)}° to ${sampleMaxX.toFixed(2)}°`)
    console.log(`  Latitude:  ${sampleMinY.toFixed(2)}° to ${sampleMaxY.toFixed(2)}°`)
    console.log(`  Altitude:  ${sampleMinZ.toFixed(2)} to ${sampleMaxZ.toFixed(2)} km`)
  }

  console.log(`\n[PotreeLoader] Valid points after filtering: ${validPoints} (${(validPoints / maxPoints * 100).toFixed(1)}%)`)

  // Create colors array (will be filled by color computation functions)
  const colors = new Uint8Array(validPoints * 3)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SORT POINTS BY GPS TIME TO RESTORE ORBITAL SEQUENCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Potree stores points in spatial (octree) order, which destroys
  // the temporal sequence. We need to sort by GPS time to restore
  // the orbital track order so points appear as a continuous path.

  if (validPoints > 0) {
    console.log(`[PotreeLoader] ⏰ Sorting ${validPoints.toLocaleString()} points by GPS time to restore orbital sequence...`)

    // Create array of indices with their GPS times
    const indices = Array.from({ length: validPoints }, (_, i) => i)

    // Sort indices by GPS time
    indices.sort((a, b) => gpsTimes[a] - gpsTimes[b])

    // Create new sorted arrays
    const sortedPositions = new Float32Array(validPoints * 3)
    const sortedIntensities = new Uint16Array(validPoints)
    const sortedClassifications = new Uint8Array(validPoints)
    const sortedGpsTimes = new Float64Array(validPoints)
    const sortedColors = new Uint8Array(validPoints * 3)

    // Copy data in sorted order
    for (let newIdx = 0; newIdx < validPoints; newIdx++) {
      const oldIdx = indices[newIdx]

      sortedPositions[newIdx * 3] = positions[oldIdx * 3]
      sortedPositions[newIdx * 3 + 1] = positions[oldIdx * 3 + 1]
      sortedPositions[newIdx * 3 + 2] = positions[oldIdx * 3 + 2]

      sortedIntensities[newIdx] = intensities[oldIdx]
      sortedClassifications[newIdx] = classifications[oldIdx]
      sortedGpsTimes[newIdx] = gpsTimes[oldIdx]

      if (colors) {
        sortedColors[newIdx * 3] = colors[oldIdx * 3]
        sortedColors[newIdx * 3 + 1] = colors[oldIdx * 3 + 1]
        sortedColors[newIdx * 3 + 2] = colors[oldIdx * 3 + 2]
      }
    }

    // Replace arrays with sorted versions
    positions.set(sortedPositions)
    intensities.set(sortedIntensities)
    classifications.set(sortedClassifications)
    gpsTimes.set(sortedGpsTimes)
    colors.set(sortedColors)

    console.log(`[PotreeLoader] ✅ Points sorted by GPS time - orbital track sequence restored`)
    console.log(`[PotreeLoader] 📊 GPS time range: ${sortedGpsTimes[0].toFixed(2)} to ${sortedGpsTimes[validPoints-1].toFixed(2)} seconds`)
  }

  // Warn if spatial filter yielded no points
  if (options?.spatialBounds && validPoints === 0) {
    console.warn(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.warn(`[PotreeLoader] ⚠️  SPATIAL FILTER RETURNED 0 POINTS!`)
    console.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.warn(`Your spatial filter:`)
    console.warn(`  • Lon: ${options.spatialBounds.minLon}° to ${options.spatialBounds.maxLon}°`)
    console.warn(`  • Lat: ${options.spatialBounds.minLat}° to ${options.spatialBounds.maxLat}°`)
    console.warn(`  • Alt: ${options.spatialBounds.minAlt} to ${options.spatialBounds.maxAlt} km`)

    if (dataSamples.length > 0) {
      const sampleMinX = Math.min(...dataSamples.map(p => p.x))
      const sampleMaxX = Math.max(...dataSamples.map(p => p.x))
      const sampleMinY = Math.min(...dataSamples.map(p => p.y))
      const sampleMaxY = Math.max(...dataSamples.map(p => p.y))
      const sampleMinZ = Math.min(...dataSamples.map(p => p.z))
      const sampleMaxZ = Math.max(...dataSamples.map(p => p.z))

      console.warn(`\nActual satellite track location:`)
      console.warn(`  • Lon: ${sampleMinX.toFixed(2)}° to ${sampleMaxX.toFixed(2)}°`)
      console.warn(`  • Lat: ${sampleMinY.toFixed(2)}° to ${sampleMaxY.toFixed(2)}°`)
      console.warn(`  • Alt: ${sampleMinZ.toFixed(2)} to ${sampleMaxZ.toFixed(2)} km`)

      console.warn(`\n💡 SUGGESTION: Adjust your spatial bounds to overlap with the actual data!`)
    }
    console.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
  }

  // Trim arrays to actual point count
  return {
    positions: positions.slice(0, validPoints * 3),
    intensities: intensities.slice(0, validPoints),
    classifications: classifications.slice(0, validPoints),
    gpsTimes: gpsTimes.slice(0, validPoints),
    colors: colors,
    pointCount: validPoints,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    }
  }
}

/**
 * Parse Potree binary point data using Web Workers for parallel processing
 *
 * This function splits the parsing work across multiple CPU cores for 3-4x speedup
 * on typical hardware. Each worker parses a chunk of points independently.
 *
 * @param buffer - ArrayBuffer containing point data
 * @param metadata - Potree metadata
 * @param options - Optional filtering options
 * @returns Promise resolving to PointCloudData
 */
async function parsePotreePointsParallel(
  buffer: ArrayBuffer,
  metadata: PotreeMetadata,
  options?: {
    spatialBounds?: {
      minLon: number
      maxLon: number
      minLat: number
      maxLat: number
      minAlt: number
      maxAlt: number
    }
  }
): Promise<PointCloudData> {
  const startTime = performance.now()

  // Calculate point stride (total bytes per point)
  const stride = metadata.attributes.reduce((sum, attr) => sum + attr.size, 0)

  // Calculate total point count
  const totalPoints = Math.floor(buffer.byteLength / stride)
  console.log(`[PotreeLoader] 🚀 Parallel parsing ${totalPoints.toLocaleString()} points using Web Workers...`)

  // Find attribute offsets
  let offset = 0
  const attributeOffsets: Record<string, number> = {}
  for (const attr of metadata.attributes) {
    attributeOffsets[attr.name] = offset
    offset += attr.size
  }

  // Detect number of CPU cores (use up to 8 workers max)
  const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 8)
  console.log(`[PotreeLoader] 💻 Using ${numWorkers} worker threads (${navigator.hardwareConcurrency} cores detected)`)

  // Split points into chunks (one per worker)
  const pointsPerWorker = Math.ceil(totalPoints / numWorkers)

  // Create workers and send chunks
  const workers: Worker[] = []
  const promises: Promise<any>[] = []

  for (let i = 0; i < numWorkers; i++) {
    const startPoint = i * pointsPerWorker
    const endPoint = Math.min((i + 1) * pointsPerWorker, totalPoints)

    if (startPoint >= totalPoints) break

    // Create worker
    const worker = new Worker(
      new URL('../workers/potreeParser.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workers.push(worker)

    // Create promise for this worker's result
    const promise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        resolve(e.data)
        worker.terminate()
      }
      worker.onerror = (error) => {
        reject(error)
        worker.terminate()
      }

      // Send work to worker
      // Workers only READ from the buffer, so they can share it safely
      // No need to clone - this saves massive memory (8x 1.3GB = 10GB!)
      worker.postMessage({
        type: 'PARSE_CHUNK',
        buffer: buffer,
        startPoint,
        endPoint,
        stride,
        attributeOffsets,
        scale: metadata.scale,
        offset: metadata.offset,
        spatialBounds: options?.spatialBounds,
        chunkId: i
      })
    })

    promises.push(promise)

    console.log(`[PotreeLoader] 📤 Worker ${i + 1}: parsing points ${startPoint.toLocaleString()} - ${endPoint.toLocaleString()}`)
  }

  // Wait for all workers to complete
  console.log(`[PotreeLoader] ⏳ Waiting for ${workers.length} workers to complete...`)
  const results = await Promise.all(promises)

  const parseTime = performance.now() - startTime
  console.log(`[PotreeLoader] ✅ Parallel parsing complete in ${parseTime.toFixed(0)}ms`)

  // Merge results from all workers
  const totalValidPoints = results.reduce((sum, r) => sum + r.pointCount, 0)
  console.log(`[PotreeLoader] 🔀 Merging ${totalValidPoints.toLocaleString()} valid points from ${results.length} workers...`)

  const mergedPositions = new Float32Array(totalValidPoints * 3)
  const mergedIntensities = new Uint16Array(totalValidPoints)
  const mergedClassifications = new Uint8Array(totalValidPoints)
  const mergedGpsTimes = new Float64Array(totalValidPoints)
  const mergedColors = new Uint8Array(totalValidPoints * 3)

  let mergeOffset = 0
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity

  for (const result of results) {
    if (result.pointCount === 0) continue

    mergedPositions.set(result.positions, mergeOffset * 3)
    mergedIntensities.set(result.intensities, mergeOffset)
    mergedClassifications.set(result.classifications, mergeOffset)
    mergedGpsTimes.set(result.gpsTimes, mergeOffset)
    mergedColors.set(result.colors, mergeOffset * 3)

    // Update global bounds
    minX = Math.min(minX, result.bounds.min[0])
    minY = Math.min(minY, result.bounds.min[1])
    minZ = Math.min(minZ, result.bounds.min[2])
    maxX = Math.max(maxX, result.bounds.max[0])
    maxY = Math.max(maxY, result.bounds.max[1])
    maxZ = Math.max(maxZ, result.bounds.max[2])

    mergeOffset += result.pointCount
  }

  console.log(`\n[PotreeLoader] Valid points after filtering: ${totalValidPoints} (${(totalValidPoints / totalPoints * 100).toFixed(1)}%)`)
  console.log(`\n[PotreeLoader] 📊 ACTUAL DATA DISTRIBUTION:`)
  console.log(`  Longitude: ${minX.toFixed(2)}° to ${maxX.toFixed(2)}°`)
  console.log(`  Latitude:  ${minY.toFixed(2)}° to ${maxY.toFixed(2)}°`)
  console.log(`  Altitude:  ${minZ.toFixed(2)} to ${maxZ.toFixed(2)} km`)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SORT POINTS BY GPS TIME TO RESTORE ORBITAL SEQUENCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (totalValidPoints > 0) {
    console.log(`[PotreeLoader] ⏰ Sorting ${totalValidPoints.toLocaleString()} points by GPS time to restore orbital sequence...`)
    const sortStart = performance.now()

    // Create array of indices
    const indices = Array.from({ length: totalValidPoints }, (_, i) => i)

    // Sort indices by GPS time
    indices.sort((a, b) => mergedGpsTimes[a] - mergedGpsTimes[b])

    // Create new sorted arrays
    const sortedPositions = new Float32Array(totalValidPoints * 3)
    const sortedIntensities = new Uint16Array(totalValidPoints)
    const sortedClassifications = new Uint8Array(totalValidPoints)
    const sortedGpsTimes = new Float64Array(totalValidPoints)
    const sortedColors = new Uint8Array(totalValidPoints * 3)

    // Copy data in sorted order
    for (let newIdx = 0; newIdx < totalValidPoints; newIdx++) {
      const oldIdx = indices[newIdx]

      sortedPositions[newIdx * 3] = mergedPositions[oldIdx * 3]
      sortedPositions[newIdx * 3 + 1] = mergedPositions[oldIdx * 3 + 1]
      sortedPositions[newIdx * 3 + 2] = mergedPositions[oldIdx * 3 + 2]

      sortedIntensities[newIdx] = mergedIntensities[oldIdx]
      sortedClassifications[newIdx] = mergedClassifications[oldIdx]
      sortedGpsTimes[newIdx] = mergedGpsTimes[oldIdx]

      sortedColors[newIdx * 3] = mergedColors[oldIdx * 3]
      sortedColors[newIdx * 3 + 1] = mergedColors[oldIdx * 3 + 1]
      sortedColors[newIdx * 3 + 2] = mergedColors[oldIdx * 3 + 2]
    }

    const sortTime = performance.now() - sortStart
    console.log(`[PotreeLoader] ✅ Points sorted by GPS time in ${sortTime.toFixed(0)}ms - orbital track sequence restored`)
    console.log(`[PotreeLoader] 📊 GPS time range: ${sortedGpsTimes[0].toFixed(2)} to ${sortedGpsTimes[totalValidPoints-1].toFixed(2)} seconds`)

    const totalTime = performance.now() - startTime
    console.log(`\n[PotreeLoader] ⚡ Total parallel processing time: ${totalTime.toFixed(0)}ms (parse: ${parseTime.toFixed(0)}ms, sort: ${sortTime.toFixed(0)}ms)`)

    return {
      positions: sortedPositions,
      intensities: sortedIntensities,
      classifications: sortedClassifications,
      gpsTimes: sortedGpsTimes,
      colors: sortedColors,
      pointCount: totalValidPoints,
      bounds: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ]
      }
    }
  }

  // No valid points after filtering
  return {
    positions: mergedPositions,
    intensities: mergedIntensities,
    classifications: mergedClassifications,
    gpsTimes: mergedGpsTimes,
    colors: mergedColors,
    pointCount: totalValidPoints,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    }
  }
}

/**
 * Load a chunk of Potree data using HTTP Range request
 * Used for progressive/LOD loading
 *
 * @param baseUrl - Base URL of the Potree directory
 * @param offset - Byte offset in octree.bin
 * @param size - Number of bytes to read
 * @param metadata - Potree metadata
 * @returns Promise resolving to PointCloudData for the chunk
 */
export async function loadPotreeChunk(
  baseUrl: string,
  offset: number,
  size: number,
  metadata: PotreeMetadata
): Promise<PointCloudData> {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  // Try flat structure first (octree.bin in root)
  let octreeUrl = `${normalizedBaseUrl}octree.bin`
  let response = await fetch(octreeUrl, { method: 'HEAD' })

  // If flat structure fails, try standard Potree 2.0 structure
  if (!response.ok) {
    octreeUrl = `${normalizedBaseUrl}pointclouds/index/octree.bin`
  }

  console.log(`[PotreeLoader] Loading chunk: offset=${offset}, size=${size} from ${octreeUrl}`)

  try {
    response = await fetch(octreeUrl, {
      headers: {
        'Range': `bytes=${offset}-${offset + size - 1}`
      }
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch chunk: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return parsePotreePoints(arrayBuffer, metadata)
  } catch (error) {
    console.error('[PotreeLoader] Failed to load chunk:', error)
    throw error
  }
}
