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
  // Potree 2.0 standard structure: baseUrl/pointclouds/index/metadata.json
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const metadataUrl = `${normalizedBaseUrl}pointclouds/index/metadata.json`
  console.log(`[PotreeLoader] Loading metadata from: ${metadataUrl}`)

  try {
    const response = await fetch(metadataUrl)
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

    // Load octree.bin with all point data (Potree 2.0 structure)
    const octreeUrl = `${normalizedBaseUrl}pointclouds/index/octree.bin`
    console.log(`[PotreeLoader] Loading octree from: ${octreeUrl}`)

    const response = await fetch(octreeUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch octree: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    console.log(`[PotreeLoader] Loaded octree.bin: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`)

    // Parse the binary point data
    const pointData = parsePotreePoints(arrayBuffer, metadata, options)

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

  // Bounds tracking
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  // Spatial filtering temporarily disabled for debugging

  // Parse each point
  for (let i = 0; i < maxPoints; i++) {
    const pointOffset = i * stride

    // Read position (int32 x, y, z)
    const posOffset = pointOffset + attributeOffsets['position']
    const x = view.getInt32(posOffset, true) * metadata.scale[0] + metadata.offset[0]
    const y = view.getInt32(posOffset + 4, true) * metadata.scale[1] + metadata.offset[1]
    const z = view.getInt32(posOffset + 8, true) * metadata.scale[2] + metadata.offset[2]

    // Debug: log first point only
    if (i === 0) {
      console.log(`[PotreeLoader] First point: x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)}`)
    }

    // Apply spatial filtering if provided
    // TEMPORARILY DISABLED FOR DEBUGGING - TO SEE ALL DATA
    // if (options?.spatialBounds) {
    //   const bounds = options.spatialBounds
    //   if (x < bounds.minLon || x > bounds.maxLon ||
    //       y < bounds.minLat || y > bounds.maxLat ||
    //       z < bounds.minAlt || z > bounds.maxAlt) {
    //     // Debug: log first few filtered points
    //     if (i < 3) {
    //       console.log(`[PotreeLoader] Point ${i} FILTERED OUT - outside bounds`)
    //     }
    //     continue // Skip this point
    //   }
    // }

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

  console.log(`[PotreeLoader] Valid points after filtering: ${validPoints} (${(validPoints / maxPoints * 100).toFixed(1)}%)`)

  // Trim arrays to actual point count
  return {
    positions: positions.slice(0, validPoints * 3),
    intensities: intensities.slice(0, validPoints),
    classifications: classifications.slice(0, validPoints),
    gpsTimes: gpsTimes.slice(0, validPoints),
    pointCount: validPoints,
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
  const octreeUrl = `${normalizedBaseUrl}pointclouds/index/octree.bin`

  console.log(`[PotreeLoader] Loading chunk: offset=${offset}, size=${size}`)

  try {
    const response = await fetch(octreeUrl, {
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
