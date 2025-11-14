/**
 * Web Worker for parallel Potree point parsing
 *
 * Parses a chunk of Potree binary data in a separate thread
 * to enable multi-core CPU utilization.
 */

interface PotreeAttribute {
  name: string
  description: string
  size: number
  numElements: number
  elementSize: number
  type: string
}

interface ParseChunkMessage {
  type: 'PARSE_CHUNK'
  buffer: ArrayBuffer
  startPoint: number
  endPoint: number
  stride: number
  attributeOffsets: Record<string, number>
  scale: [number, number, number]
  offset: [number, number, number]
  spatialBounds?: {
    minLon: number
    maxLon: number
    minLat: number
    maxLat: number
    minAlt: number
    maxAlt: number
  }
}

interface ParseChunkResult {
  type: 'PARSE_COMPLETE'
  chunkId: number
  positions: Float32Array
  intensities: Uint16Array
  classifications: Uint8Array
  gpsTimes: Float64Array
  colors: Uint8Array
  pointCount: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

self.onmessage = (e: MessageEvent<ParseChunkMessage & { chunkId: number }>) => {
  const { type, buffer, startPoint, endPoint, stride, attributeOffsets, scale, offset, spatialBounds, chunkId } = e.data

  if (type !== 'PARSE_CHUNK') {
    return
  }

  const maxPoints = endPoint - startPoint
  const view = new DataView(buffer)

  // Pre-allocate arrays for maximum possible points
  const positions = new Float32Array(maxPoints * 3)
  const intensities = new Uint16Array(maxPoints)
  const classifications = new Uint8Array(maxPoints)
  const gpsTimes = new Float64Array(maxPoints)
  const colors = new Uint8Array(maxPoints * 3)

  let validPoints = 0
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity

  // Parse points in this chunk
  for (let i = startPoint; i < endPoint; i++) {
    const pointOffset = i * stride

    // Read position (int32 x, y, z) and apply scale/offset
    const posOffset = pointOffset + attributeOffsets['position']
    const x = view.getInt32(posOffset, true) * scale[0] + offset[0]
    const y = view.getInt32(posOffset + 4, true) * scale[1] + offset[1]
    const z = view.getInt32(posOffset + 8, true) * scale[2] + offset[2]

    // Apply spatial filtering if enabled
    if (spatialBounds) {
      if (x < spatialBounds.minLon || x > spatialBounds.maxLon ||
          y < spatialBounds.minLat || y > spatialBounds.maxLat ||
          z < spatialBounds.minAlt || z > spatialBounds.maxAlt) {
        continue // Skip this point
      }
    }

    // Store position
    positions[validPoints * 3] = x
    positions[validPoints * 3 + 1] = y
    positions[validPoints * 3 + 2] = z

    // Update bounds
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)

    // Read intensity (uint16)
    intensities[validPoints] = view.getUint16(pointOffset + attributeOffsets['intensity'], true)

    // Read classification (uint8)
    classifications[validPoints] = view.getUint8(pointOffset + attributeOffsets['classification'])

    // Read GPS time (float64)
    gpsTimes[validPoints] = view.getFloat64(pointOffset + attributeOffsets['gps-time'], true)

    validPoints++
  }

  // Trim arrays to actual count
  const result: ParseChunkResult = {
    type: 'PARSE_COMPLETE',
    chunkId,
    positions: positions.slice(0, validPoints * 3),
    intensities: intensities.slice(0, validPoints),
    classifications: classifications.slice(0, validPoints),
    gpsTimes: gpsTimes.slice(0, validPoints),
    colors: colors.slice(0, validPoints * 3),
    pointCount: validPoints,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    }
  }

  // Send result back to main thread (transfer arrays for zero-copy)
  self.postMessage(result, [
    result.positions.buffer,
    result.intensities.buffer,
    result.classifications.buffer,
    result.gpsTimes.buffer,
    result.colors.buffer
  ])
}
