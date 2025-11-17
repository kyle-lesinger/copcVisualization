import * as THREE from 'three'
import { Colormap } from './colormaps'
import { computeElevationColors, computeIntensityColors, computeClassificationColors } from './copcLoader'
import { latLonAltToVector3 } from './coordinateConversion'
import { loadPotreeMetadata, loadPotreeChunk, PotreeMetadata } from './potreeLoader'

/**
 * Potree Octree Node for LOD management
 */
export interface PotreeNode {
  name: string // Octree node name (e.g., "r", "r0", "r01", etc.)
  depth: number
  pointCount: number
  bounds: THREE.Box3
  loaded: boolean
  points?: THREE.Points
  children?: string[] // Child node names
  byteOffset: number // Offset in octree.bin file
  byteSize: number // Size in bytes
  pointData?: {
    positions: Float32Array
    colors: Uint8Array
    intensities: Uint16Array
    classifications: Uint8Array
    gpsTimes?: Float64Array // GPS time for each point (TAI93)
  }
}

/**
 * Spatial bounds filter for selective data loading
 */
export interface SpatialBounds {
  enabled: boolean
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
  minAlt: number
  maxAlt: number
}

/**
 * GPS time range filter for selective data loading
 */
export interface TimeRange {
  enabled: boolean
  minGpsTime: number // TAI seconds since 1993-01-01
  maxGpsTime: number // TAI seconds since 1993-01-01
}

/**
 * Potree LOD Manager - Handles hierarchical loading of Potree point cloud data
 */
export class PotreeLODManager {
  private baseUrl: string
  private metadata: PotreeMetadata | null = null
  private scene: THREE.Scene
  private nodes: Map<string, PotreeNode> = new Map()
  private rootNode: PotreeNode | null = null
  private pointBudget: number = 500_000 // Max points to display (reduced for performance)
  private currentPointCount: number = 0
  private hasLoggedFrustumCull: boolean = false
  private maxPointsPerNode: number = 500_000 // Limit points per node

  // Rendering control callbacks
  private pauseRendering: (() => void) | null = null
  private resumeRendering: (() => void) | null = null

  // Rendering parameters
  private colorMode: 'elevation' | 'intensity' | 'classification' = 'intensity'
  private colormap: Colormap = 'plasma'
  private pointSize: number = 2.0

  // Data range for color mapping
  private dataRange = {
    elevation: [0, 40] as [number, number],
    intensity: [0, 3.5] as [number, number]
  }

  // Height filter
  private heightFilter: { enabled: boolean, min: number, max: number } | null = null

  // Spatial bounds filter
  private spatialBounds: SpatialBounds | null = null

  // GPS time range filter
  private timeRange: TimeRange | null = null

  // First and last points for satellite animation
  private firstPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null = null
  private lastPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null = null

  constructor(
    baseUrl: string,
    scene: THREE.Scene,
    pauseRendering?: () => void,
    resumeRendering?: () => void
  ) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    this.scene = scene
    this.pauseRendering = pauseRendering || null
    this.resumeRendering = resumeRendering || null
  }

  /**
   * Initialize Potree file and load hierarchy
   */
  async initialize(): Promise<void> {
    console.log('[PotreeLODManager] Initializing Potree data:', this.baseUrl)

    // Load metadata
    this.metadata = await loadPotreeMetadata(this.baseUrl)

    console.log('[PotreeLODManager] Potree Info:', {
      version: this.metadata.version,
      pointCount: this.metadata.points,
      bounds: this.metadata.boundingBox,
      spacing: this.metadata.spacing,
      hierarchyDepth: this.metadata.hierarchy.depth
    })

    // Load hierarchy
    await this.loadHierarchy()

    // Find root node
    this.rootNode = this.nodes.get('r') || null
    if (!this.rootNode) {
      throw new Error('No root node found in hierarchy')
    }

    console.log('[PotreeLODManager] Initialization complete')
  }

  /**
   * Load Potree hierarchy.bin file
   */
  private async loadHierarchy(): Promise<void> {
    // Potree 2.0 standard structure
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    const hierarchyUrl = `${normalizedBaseUrl}pointclouds/index/hierarchy.bin`
    console.log('[PotreeLODManager] Loading hierarchy from:', hierarchyUrl)

    const response = await fetch(hierarchyUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch hierarchy: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    this.parseHierarchy(arrayBuffer)
  }

  /**
   * Parse Potree hierarchy.bin
   * Format: [firstChunkSize bytes of root + children], [stepSize bytes per subsequent node]
   */
  private parseHierarchy(buffer: ArrayBuffer): void {
    if (!this.metadata) {
      throw new Error('Metadata not loaded')
    }

    const view = new DataView(buffer)

    // Potree 2.0 format: each node is 22 bytes
    // Format: type (1) + childMask (1) + pointCount (4) + byteOffset (8) + byteSize (8)
    const nodeSize = 22
    const numNodes = Math.floor(buffer.byteLength / nodeSize)

    // First pass: Read all node data
    interface NodeData {
      type: number
      childMask: number
      pointCount: number
      byteOffset: number
      byteSize: number
    }
    const nodeDataArray: NodeData[] = []

    for (let i = 0; i < numNodes; i++) {
      const offset = i * nodeSize

      const type = view.getUint8(offset)
      const childMask = view.getUint8(offset + 1)
      const pointCount = view.getUint32(offset + 2, true)

      const byteOffsetLow = view.getUint32(offset + 6, true)
      const byteOffsetHigh = view.getUint32(offset + 10, true)
      const byteOffset = byteOffsetLow + (byteOffsetHigh * 0x100000000)

      const byteSizeLow = view.getUint32(offset + 14, true)
      const byteSizeHigh = view.getUint32(offset + 18, true)
      const byteSize = byteSizeLow + (byteSizeHigh * 0x100000000)

      nodeDataArray.push({ type, childMask, pointCount, byteOffset, byteSize })

      // Debug first 5 nodes
      if (i < 5) {
        console.log(`[PotreeLODManager] Node ${i}: type=${type}, childMask=${childMask}, pointCount=${pointCount}, byteSize=${byteSize}, byteOffset=${byteOffset}`)
      }
    }

    // Second pass: Build octree structure with proper names
    // Nodes are stored in breadth-first order
    // We need to assign names based on the tree structure
    const nameQueue: string[] = ['r'] // Start with root
    let nodeIndex = 0

    while (nodeIndex < nodeDataArray.length && nameQueue.length > 0) {
      const nodeName = nameQueue.shift()! // Get next name from queue
      const nodeData = nodeDataArray[nodeIndex]

      // Calculate depth from name
      const depth = nodeName === 'r' ? 0 : nodeName.length - 1

      // Calculate bounds (simplified - using metadata bounds for all nodes)
      const bounds = new THREE.Box3(
        new THREE.Vector3(...this.metadata!.boundingBox.min),
        new THREE.Vector3(...this.metadata!.boundingBox.max)
      )

      const node: PotreeNode = {
        name: nodeName,
        depth,
        pointCount: nodeData.pointCount,
        bounds,
        loaded: false,
        byteOffset: nodeData.byteOffset,
        byteSize: nodeData.byteSize,
        children: []
      }

      // Parse child mask to determine which children exist
      // Add them to the name queue in order (0-7)
      for (let i = 0; i < 8; i++) {
        if (nodeData.childMask & (1 << i)) {
          const childName = `${nodeName}${i}`
          node.children!.push(childName)
          nameQueue.push(childName)
        }
      }

      this.nodes.set(nodeName, node)

      // Set root node reference
      if (nodeName === 'r') {
        this.rootNode = node
      }

      // Debug first 10 nodes to verify structure
      if (nodeIndex < 10) {
        console.log(`[PotreeLODManager] Created node "${nodeName}" (index ${nodeIndex}): ${nodeData.pointCount} points, children: [${node.children.join(', ')}]`)
      }

      nodeIndex++
    }

    console.log(`[PotreeLODManager] Loaded hierarchy nodes: ${this.nodes.size}`)
  }

  /**
   * Compute bounding box for a child node (simplified)
   */
  private computeChildBounds(parentNode: PotreeNode, depth: number): THREE.Box3 {
    if (!this.metadata) {
      return new THREE.Box3()
    }

    // Simplified: subdivide parent bounds by 2
    const parent = parentNode.bounds
    const center = new THREE.Vector3()
    parent.getCenter(center)

    // This is oversimplified - real implementation would need octree subdivision logic
    return new THREE.Box3(
      new THREE.Vector3(parent.min.x, parent.min.y, parent.min.z),
      new THREE.Vector3(center.x, center.y, center.z)
    )
  }

  /**
   * Update visible nodes based on camera frustum and distance
   */
  async update(camera: THREE.Camera): Promise<void> {
    if (!this.rootNode || !this.metadata) return

    // Create frustum from camera
    const frustum = new THREE.Frustum()
    const projectionMatrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )
    frustum.setFromProjectionMatrix(projectionMatrix)

    // Reset point count
    this.currentPointCount = 0

    // Traverse octree and determine which nodes to load/unload
    await this.traverseOctree(this.rootNode, camera, frustum)

    console.log(`[PotreeLODManager] Current points: ${this.currentPointCount} / ${this.pointBudget}`)
  }

  /**
   * Recursively traverse octree and load/unload nodes
   */
  private async traverseOctree(
    node: PotreeNode,
    camera: THREE.Camera,
    frustum: THREE.Frustum
  ): Promise<void> {
    // Check if node is in frustum
    if (!frustum.intersectsBox(node.bounds)) {
      // Unload if not visible
      if (node.loaded) {
        this.unloadNode(node)
      }
      return
    }

    // Check spatial bounds filter
    if (!this.nodeIntersectsSpatialBounds(node)) {
      return
    }

    // Calculate distance from camera to node center
    const nodeCenter = new THREE.Vector3()
    node.bounds.getCenter(nodeCenter)
    const distance = camera.position.distanceTo(nodeCenter)

    // Determine if we should load this node's children based on LOD
    const nodeSize = node.bounds.getSize(new THREE.Vector3()).length()
    const screenSpaceError = (nodeSize / distance) * 1000

    // Use more aggressive LOD - only load children if we're very close
    const shouldLoadChildren = screenSpaceError > 100 && node.children && node.children.length > 0

    if (shouldLoadChildren) {
      // Load children nodes instead
      for (const childName of node.children!) {
        const childNode = this.nodes.get(childName)
        if (childNode) {
          await this.traverseOctree(childNode, camera, frustum)
        }
      }
    } else {
      // Load this node if within budget
      if (!node.loaded && this.currentPointCount < this.pointBudget) {
        await this.loadNode(node)
      }

      if (node.loaded) {
        this.currentPointCount += node.pointCount
      }
    }
  }

  /**
   * Load a node's point data and create THREE.Points
   */
  private async loadNode(node: PotreeNode): Promise<void> {
    if (!this.metadata) return

    console.log(`[PotreeLODManager] Loading node: ${node.name}`)

    // Validate node has points and reasonable byteSize
    if (node.pointCount === 0 || node.byteSize === 0) {
      console.warn(`[PotreeLODManager] Skipping node ${node.name}: no points or zero byteSize`)
      node.loaded = true // Mark as loaded to prevent retries
      return
    }

    // Sanity check: byteOffset + byteSize should be reasonable (< 10GB)
    const maxFileSize = 10 * 1024 * 1024 * 1024 // 10 GB
    if (node.byteOffset + node.byteSize > maxFileSize) {
      console.error(`[PotreeLODManager] Invalid byte range for node ${node.name}: offset=${node.byteOffset}, size=${node.byteSize}`)
      console.error('[PotreeLODManager] This suggests corrupted hierarchy data - skipping node')
      node.loaded = true // Mark as loaded to prevent infinite retries
      return
    }

    try {
      // Load point data from octree.bin using HTTP Range request
      let pointData = await loadPotreeChunk(
        this.baseUrl,
        node.byteOffset,
        node.byteSize,
        this.metadata
      )

      // Limit points for performance (subsample if needed)
      if (pointData.pointCount > this.maxPointsPerNode) {
        console.log(`[PotreeLODManager] Subsampling node ${node.name}: ${pointData.pointCount} → ${this.maxPointsPerNode} points`)
        pointData = this.subsamplePoints(pointData, this.maxPointsPerNode)
      }

      // Apply spatial bounds filter (point-level filtering)
      // TEMPORARILY DISABLED FOR DEBUGGING - TO SEE ALL DATA
      // if (this.spatialBounds && this.spatialBounds.enabled) {
      //   pointData = this.applySpatialBoundsFilter(pointData)
      // }
      console.log(`[PotreeLODManager] Node ${node.name}: Loaded ${pointData.pointCount} points (spatial filtering DISABLED)`)

      // Apply height filter
      let filteredData = pointData
      if (this.heightFilter && this.heightFilter.enabled) {
        filteredData = this.applyHeightFilter(pointData)
      }

      // Apply time range filter
      if (this.timeRange && this.timeRange.enabled) {
        filteredData = this.applyTimeRangeFilter(filteredData)
      }

      // Compute colors
      const colors = this.computeColors(
        filteredData.positions,
        filteredData.intensities,
        filteredData.classifications
      )

      // Store point data
      node.pointData = {
        positions: filteredData.positions,
        colors,
        intensities: filteredData.intensities,
        classifications: filteredData.classifications,
        gpsTimes: filteredData.gpsTimes
      }

      // Create THREE.Points geometry
      const geometry = new THREE.BufferGeometry()

      // Convert lat/lon/alt to 3D coordinates
      const positions3D = new Float32Array(filteredData.pointCount * 3)
      for (let i = 0; i < filteredData.pointCount; i++) {
        const lon = filteredData.positions[i * 3]
        const lat = filteredData.positions[i * 3 + 1]
        const alt = filteredData.positions[i * 3 + 2]

        const vec = latLonAltToVector3(lat, lon, alt)
        positions3D[i * 3] = vec.x
        positions3D[i * 3 + 1] = vec.y
        positions3D[i * 3 + 2] = vec.z
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions3D, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      // Create material
      const material = new THREE.PointsMaterial({
        size: this.pointSize,
        vertexColors: true,
        sizeAttenuation: false
      })

      // Create points object
      node.points = new THREE.Points(geometry, material)
      this.scene.add(node.points)

      node.loaded = true
    } catch (error) {
      console.error(`[PotreeLODManager] Failed to load node ${node.name}:`, error)
      // Mark as loaded to prevent infinite retry loop
      node.loaded = true
    }
  }

  /**
   * Unload a node's point data
   */
  private unloadNode(node: PotreeNode): void {
    if (node.points) {
      this.scene.remove(node.points)
      node.points.geometry.dispose()
      if (Array.isArray(node.points.material)) {
        node.points.material.forEach(m => m.dispose())
      } else {
        node.points.material.dispose()
      }
      node.points = undefined
    }
    node.loaded = false
    node.pointData = undefined
  }

  /**
   * Check if node bounds intersect with spatial bounds filter
   */
  private nodeIntersectsSpatialBounds(node: PotreeNode): boolean {
    if (!this.spatialBounds || !this.spatialBounds.enabled) {
      return true
    }

    const nodeBounds = node.bounds
    const filter = this.spatialBounds

    if (nodeBounds.max.x < filter.minLon || nodeBounds.min.x > filter.maxLon) {
      return false
    }
    if (nodeBounds.max.y < filter.minLat || nodeBounds.min.y > filter.maxLat) {
      return false
    }
    if (nodeBounds.max.z < filter.minAlt || nodeBounds.min.z > filter.maxAlt) {
      return false
    }

    return true
  }

  /**
   * Subsample points to reduce count (for performance)
   */
  private subsamplePoints(pointData: any, maxPoints: number): any {
    const totalPoints = pointData.pointCount
    const step = Math.ceil(totalPoints / maxPoints)

    const subsampled: number[] = []
    const subsampledIntensities: number[] = []
    const subsampledClassifications: number[] = []
    const subsampledGpsTimes: number[] = []

    let count = 0
    for (let i = 0; i < totalPoints; i += step) {
      subsampled.push(
        pointData.positions[i * 3],
        pointData.positions[i * 3 + 1],
        pointData.positions[i * 3 + 2]
      )
      subsampledIntensities.push(pointData.intensities[i])
      subsampledClassifications.push(pointData.classifications[i])
      if (pointData.gpsTimes) {
        subsampledGpsTimes.push(pointData.gpsTimes[i])
      }
      count++
    }

    return {
      positions: new Float32Array(subsampled),
      intensities: new Uint16Array(subsampledIntensities),
      classifications: new Uint8Array(subsampledClassifications),
      gpsTimes: pointData.gpsTimes ? new Float64Array(subsampledGpsTimes) : undefined,
      pointCount: count,
      bounds: pointData.bounds
    }
  }

  /**
   * Apply spatial bounds filter to point data
   */
  private applySpatialBoundsFilter(pointData: any): any {
    if (!this.spatialBounds) return pointData

    const { minLon, maxLon, minLat, maxLat, minAlt, maxAlt } = this.spatialBounds
    const filtered: number[] = []
    const filteredIntensities: number[] = []
    const filteredClassifications: number[] = []
    const filteredGpsTimes: number[] = []

    let filteredCount = 0
    for (let i = 0; i < pointData.pointCount; i++) {
      const lon = pointData.positions[i * 3]
      const lat = pointData.positions[i * 3 + 1]
      const alt = pointData.positions[i * 3 + 2]

      if (lon >= minLon && lon <= maxLon &&
          lat >= minLat && lat <= maxLat &&
          alt >= minAlt && alt <= maxAlt) {
        filtered.push(lon, lat, alt)
        filteredIntensities.push(pointData.intensities[i])
        filteredClassifications.push(pointData.classifications[i])
        if (pointData.gpsTimes) {
          filteredGpsTimes.push(pointData.gpsTimes[i])
        }
        filteredCount++
      }
    }

    console.log(`[PotreeLODManager] Spatial filtering: ${filteredCount}/${pointData.pointCount} points (${(filteredCount / pointData.pointCount * 100).toFixed(1)}%)`)

    return {
      positions: new Float32Array(filtered),
      intensities: new Uint16Array(filteredIntensities),
      classifications: new Uint8Array(filteredClassifications),
      gpsTimes: pointData.gpsTimes ? new Float64Array(filteredGpsTimes) : undefined,
      pointCount: filteredCount,
      bounds: pointData.bounds
    }
  }

  /**
   * Apply height filter to point data
   */
  private applyHeightFilter(pointData: any): any {
    if (!this.heightFilter) return pointData

    const { min, max } = this.heightFilter
    const filtered: number[] = []
    const filteredIntensities: number[] = []
    const filteredClassifications: number[] = []
    const filteredGpsTimes: number[] = []

    for (let i = 0; i < pointData.pointCount; i++) {
      const alt = pointData.positions[i * 3 + 2]

      if (alt >= min && alt <= max) {
        filtered.push(pointData.positions[i * 3], pointData.positions[i * 3 + 1], pointData.positions[i * 3 + 2])
        filteredIntensities.push(pointData.intensities[i])
        filteredClassifications.push(pointData.classifications[i])
        if (pointData.gpsTimes) {
          filteredGpsTimes.push(pointData.gpsTimes[i])
        }
      }
    }

    return {
      positions: new Float32Array(filtered),
      intensities: new Uint16Array(filteredIntensities),
      classifications: new Uint8Array(filteredClassifications),
      gpsTimes: pointData.gpsTimes ? new Float64Array(filteredGpsTimes) : undefined,
      pointCount: filtered.length / 3,
      bounds: pointData.bounds
    }
  }

  /**
   * Apply GPS time range filter to point data
   */
  private applyTimeRangeFilter(pointData: any): any {
    if (!this.timeRange || !pointData.gpsTimes) return pointData

    const { minGpsTime, maxGpsTime } = this.timeRange
    const filtered: number[] = []
    const filteredIntensities: number[] = []
    const filteredClassifications: number[] = []
    const filteredGpsTimes: number[] = []

    for (let i = 0; i < pointData.pointCount; i++) {
      const gpsTime = pointData.gpsTimes[i]

      if (gpsTime >= minGpsTime && gpsTime <= maxGpsTime) {
        filtered.push(pointData.positions[i * 3], pointData.positions[i * 3 + 1], pointData.positions[i * 3 + 2])
        filteredIntensities.push(pointData.intensities[i])
        filteredClassifications.push(pointData.classifications[i])
        filteredGpsTimes.push(gpsTime)
      }
    }

    return {
      positions: new Float32Array(filtered),
      intensities: new Uint16Array(filteredIntensities),
      classifications: new Uint8Array(filteredClassifications),
      gpsTimes: new Float64Array(filteredGpsTimes),
      pointCount: filtered.length / 3,
      bounds: pointData.bounds
    }
  }

  /**
   * Compute point colors based on current color mode
   */
  private computeColors(
    positions: Float32Array,
    intensities: Uint16Array,
    classifications: Uint8Array
  ): Uint8Array {
    const pointCount = positions.length / 3
    const colors = new Uint8Array(pointCount * 3)

    switch (this.colorMode) {
      case 'elevation':
        computeElevationColors(
          positions,
          colors,
          this.dataRange.elevation?.[0],
          this.dataRange.elevation?.[1],
          this.colormap
        )
        break
      case 'intensity':
        computeIntensityColors(
          intensities,
          colors,
          this.dataRange.intensity?.[0],
          this.dataRange.intensity?.[1],
          this.colormap,
          true // Use CALIPSO scaling
        )
        break
      case 'classification':
        computeClassificationColors(classifications, colors)
        break
      default:
        colors.fill(255)
    }

    return colors
  }

  /**
   * Update rendering parameters
   */
  updateRenderingParams(
    colorMode: 'elevation' | 'intensity' | 'classification',
    colormap: Colormap,
    pointSize: number,
    dataRange: { elevation: [number, number], intensity: [number, number] }
  ): void {
    this.colorMode = colorMode
    this.colormap = colormap
    this.pointSize = pointSize
    this.dataRange = dataRange

    // Update all loaded nodes
    for (const node of this.nodes.values()) {
      if (node.loaded && node.pointData) {
        const colors = this.computeColors(
          node.pointData.positions,
          node.pointData.intensities,
          node.pointData.classifications
        )

        if (node.points) {
          const geometry = node.points.geometry
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
          geometry.attributes.color.needsUpdate = true

          // Update point size
          if (node.points.material instanceof THREE.PointsMaterial) {
            node.points.material.size = pointSize
          }
        }
      }
    }
  }

  /**
   * Set height filter
   */
  setHeightFilter(filter: { enabled: boolean, min: number, max: number } | null): void {
    this.heightFilter = filter
  }

  /**
   * Set spatial bounds filter
   */
  setSpatialBounds(bounds: SpatialBounds | null): void {
    this.spatialBounds = bounds
  }

  /**
   * Set GPS time range filter
   */
  setTimeRange(range: TimeRange | null): void {
    this.timeRange = range
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    for (const node of this.nodes.values()) {
      if (node.loaded) {
        this.unloadNode(node)
      }
    }
    this.nodes.clear()
  }

  /**
   * Get first and last points for satellite animation
   */
  getFirstLastPoints(): {
    first: { lon: number, lat: number, alt: number, gpsTime: number } | null
    last: { lon: number, lat: number, gpsTime: number } | null
  } {
    return {
      first: this.firstPoint,
      last: this.lastPoint
    }
  }

  /**
   * Get first point for satellite animation
   */
  getFirstPoint(): { lon: number, lat: number, alt: number, gpsTime: number } | null {
    return this.firstPoint
  }

  /**
   * Get last point for satellite animation
   */
  getLastPoint(): { lon: number, lat: number, alt: number, gpsTime: number } | null {
    return this.lastPoint
  }

  /**
   * Set color mode
   */
  setColorMode(colorMode: 'elevation' | 'intensity' | 'classification', colormap: Colormap): void {
    this.colorMode = colorMode
    this.colormap = colormap

    // Update all loaded nodes
    this.updateRenderingParams(colorMode, colormap, this.pointSize, this.dataRange)
  }

  /**
   * Set point size
   */
  setPointSize(size: number): void {
    this.pointSize = size

    // Update all loaded nodes
    for (const node of this.nodes.values()) {
      if (node.loaded && node.points && node.points.material instanceof THREE.PointsMaterial) {
        node.points.material.size = size
      }
    }
  }

  /**
   * Get data bounds
   */
  getDataBounds(): {
    spatial: {
      minLon: number
      maxLon: number
      minLat: number
      maxLat: number
      minAlt: number
      maxAlt: number
    } | null
    gpsTime: {
      min: number
      max: number
    } | null
  } {
    if (!this.metadata) {
      return { spatial: null, gpsTime: null }
    }

    const bbox = this.metadata.boundingBox
    const gpsTimeAttr = this.metadata.attributes.find(a => a.name === 'gps-time')

    return {
      spatial: {
        minLon: bbox.min[0],
        maxLon: bbox.max[0],
        minLat: bbox.min[1],
        maxLat: bbox.max[1],
        minAlt: bbox.min[2],
        maxAlt: bbox.max[2]
      },
      gpsTime: gpsTimeAttr ? {
        min: gpsTimeAttr.min[0],
        max: gpsTimeAttr.max[0]
      } : null
    }
  }

  /**
   * Get statistics about loaded nodes
   */
  getStats(): { loadedNodes: number, totalPoints: number } {
    let loadedNodes = 0
    let totalPoints = 0

    for (const node of this.nodes.values()) {
      if (node.loaded) {
        loadedNodes++
        totalPoints += node.pointCount
      }
    }

    return { loadedNodes, totalPoints }
  }
}
