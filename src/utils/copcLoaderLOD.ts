import * as THREE from 'three'
import { Copc } from 'copc'  // Named import, not default!
import { Colormap } from './colormaps'
import { computeElevationColors, computeIntensityColors, computeClassificationColors } from './copcLoader'
import { latLonAltToVector3 } from './coordinateConversion'

/**
 * COPC Octree Node for LOD management
 */
export interface COPCNode {
  key: string // e.g., "0-0-0-0" (depth-x-y-z)
  depth: number
  x: number
  y: number
  z: number
  pointCount: number
  bounds: THREE.Box3
  loaded: boolean
  points?: THREE.Points
  children?: string[] // Child node keys
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
 * COPC LOD Manager - Handles hierarchical loading of point cloud data
 */
export class COPCLODManager {
  private copc: any
  private filename: string
  private getter: (begin: number, end: number) => Promise<Uint8Array>
  private scene: THREE.Scene
  private nodes: Map<string, COPCNode> = new Map()
  private rootNode: COPCNode | null = null
  private pointBudget: number = 2_000_000 // Max points to display
  private currentPointCount: number = 0
  private hasLoggedFrustumCull: boolean = false

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
    filename: string,
    scene: THREE.Scene,
    pauseRendering?: () => void,
    resumeRendering?: () => void
  ) {
    this.filename = filename
    this.scene = scene
    this.pauseRendering = pauseRendering || null
    this.resumeRendering = resumeRendering || null

    // Create a getter function for browser-based HTTP range requests
    this.getter = async (begin: number, end: number): Promise<Uint8Array> => {
      const headers: HeadersInit = {}
      if (begin !== undefined && end !== undefined) {
        headers.Range = `bytes=${begin}-${end - 1}`
      }

      const response = await fetch(filename, { headers })
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    }
  }

  /**
   * Initialize COPC file and load root hierarchy
   */
  async initialize(): Promise<void> {
    console.log('[COPCLODManager] Initializing COPC file:', this.filename)

    // Create COPC object with custom getter for browser
    this.copc = await Copc.create(this.getter)

    console.log('[COPCLODManager] COPC Info:', {
      pointCount: this.copc.header.pointCount,
      bounds: this.copc.info.cube,
      spacing: this.copc.info.spacing
    })

    // Load root hierarchy page
    const { nodes, pages } = await Copc.loadHierarchyPage(
      this.getter,
      this.copc.info.rootHierarchyPage
    )

    console.log('[COPCLODManager] Loaded hierarchy nodes:', Object.keys(nodes).length)

    // Parse and store nodes
    for (const [key, node] of Object.entries(nodes)) {
      const [depthStr, xStr, yStr, zStr] = key.split('-').map(Number)

      const copcNode: COPCNode = {
        key,
        depth: depthStr,
        x: xStr,
        y: yStr,
        z: zStr,
        pointCount: (node as any).pointCount,
        bounds: this.computeNodeBounds(depthStr, xStr, yStr, zStr),
        loaded: false,
        children: [] // Will be populated when child pages are loaded
      }

      this.nodes.set(key, copcNode)

      if (key === '0-0-0-0') {
        this.rootNode = copcNode
      }
    }

    // Load additional hierarchy pages if needed
    for (const [key, page] of Object.entries(pages)) {
      await this.loadHierarchyPage(page as any)
    }

    console.log('[COPCLODManager] Total nodes in hierarchy:', this.nodes.size)

    // Calculate data range from header
    this.dataRange.elevation = [this.copc.header.min[2], this.copc.header.max[2]]

    // For intensity, use CALIPSO range (already in physical units in the LAS file)
    // The intensity values in the LAS file are encoded as: (physical + 0.1) * 10000
    // Physical range for 532nm: approximately -0.1 to 3.3 km⁻¹·sr⁻¹
    this.dataRange.intensity = [0.0, 3.5]

    console.log('[COPCLODManager] Data ranges:', this.dataRange)

    // Log geographic extent for easy reference
    console.log('[COPCLODManager] 🌍 Geographic extent:')
    console.log(`  Longitude: ${this.copc.header.min[0].toFixed(2)}° to ${this.copc.header.max[0].toFixed(2)}°`)
    console.log(`  Latitude:  ${this.copc.header.min[1].toFixed(2)}° to ${this.copc.header.max[1].toFixed(2)}°`)
    console.log(`  Altitude:  ${this.copc.header.min[2].toFixed(2)} to ${this.copc.header.max[2].toFixed(2)} km`)
  }

  /**
   * Load additional hierarchy page
   */
  private async loadHierarchyPage(pageInfo: any): Promise<void> {
    const { nodes, pages } = await Copc.loadHierarchyPage(
      this.getter,
      pageInfo
    )

    for (const [key, node] of Object.entries(nodes)) {
      if (!this.nodes.has(key)) {
        const [depthStr, xStr, yStr, zStr] = key.split('-').map(Number)

        const copcNode: COPCNode = {
          key,
          depth: depthStr,
          x: xStr,
          y: yStr,
          z: zStr,
          pointCount: (node as any).pointCount,
          bounds: this.computeNodeBounds(depthStr, xStr, yStr, zStr),
          loaded: false,
          children: []
        }

        this.nodes.set(key, copcNode)
      }
    }

    // Recursively load child pages
    for (const [key, page] of Object.entries(pages)) {
      await this.loadHierarchyPage(page as any)
    }
  }

  /**
   * Compute bounding box for an octree node
   */
  private computeNodeBounds(depth: number, x: number, y: number, z: number): THREE.Box3 {
    const cube = this.copc.info.cube
    const spacing = this.copc.info.spacing

    // Calculate node size at this depth
    const nodeSize = spacing * Math.pow(2, depth)

    // Calculate min corner
    const minX = cube[0] + x * nodeSize
    const minY = cube[1] + y * nodeSize
    const minZ = cube[2] + z * nodeSize

    // Calculate max corner
    const maxX = minX + nodeSize
    const maxY = minY + nodeSize
    const maxZ = minZ + nodeSize

    return new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    )
  }

  /**
   * Update visible nodes based on camera frustum and distance
   */
  async update(camera: THREE.Camera): Promise<void> {
    if (!this.rootNode) return

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

    console.log(`[COPCLODManager] Current points: ${this.currentPointCount} / ${this.pointBudget}`)
  }

  /**
   * Check if node bounds intersect with spatial bounds filter
   */
  private nodeIntersectsSpatialBounds(node: COPCNode): boolean {
    if (!this.spatialBounds || !this.spatialBounds.enabled) {
      return true // No filter, all nodes pass
    }

    const nodeBounds = node.bounds
    const filter = this.spatialBounds

    // Check if bounding boxes intersect in 3D space
    // Node is rejected if it's completely outside any dimension of the filter
    if (nodeBounds.max.x < filter.minLon || nodeBounds.min.x > filter.maxLon) {
      return false // No overlap in X (longitude)
    }
    if (nodeBounds.max.y < filter.minLat || nodeBounds.min.y > filter.maxLat) {
      return false // No overlap in Y (latitude)
    }
    if (nodeBounds.max.z < filter.minAlt || nodeBounds.min.z > filter.maxAlt) {
      return false // No overlap in Z (altitude)
    }

    return true // Boxes intersect
  }

  /**
   * Recursively traverse octree and load/unload nodes based on visibility
   */
  private async traverseOctree(
    node: COPCNode,
    camera: THREE.Camera,
    frustum: THREE.Frustum
  ): Promise<void> {
    // TEMPORARY: Disable frustum culling for globe coordinate system
    // TODO: Convert node bounds from geographic to Cartesian coords for proper frustum culling
    const ENABLE_FRUSTUM_CULLING = false

    if (ENABLE_FRUSTUM_CULLING) {
      // Check if node bounds are in frustum
      if (!frustum.intersectsBox(node.bounds)) {
        // Not visible - unload if loaded
        if (node.loaded) {
          this.unloadNode(node)
        }

        // Log frustum culling for root node to help debug (only once)
        if (node.depth === 0 && !this.hasLoggedFrustumCull) {
          this.hasLoggedFrustumCull = true
          const bounds = node.bounds
          const center = new THREE.Vector3()
          bounds.getCenter(center)
          console.log(`[COPCLODManager] 🎥 ROOT NODE NOT IN VIEW FRUSTUM`)
          console.log(`  Node center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`)
          console.log(`  Camera pos: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`)
          console.log(`  💡 HINT: Data is at Lon -180°, Lat -55° (behind globe from current view)`)
          console.log(`  💡 SOLUTION: Rotate the globe to bring data into view`)
        }
        return
      }

      // Reset frustum cull flag when node comes into view
      if (node.depth === 0 && this.hasLoggedFrustumCull) {
        this.hasLoggedFrustumCull = false
        console.log(`[COPCLODManager] ✅ Data now in view! Loading points...`)
      }
    } else {
      // Log that frustum culling is disabled (once)
      if (node.depth === 0 && !this.hasLoggedFrustumCull) {
        this.hasLoggedFrustumCull = true
        console.log(`[COPCLODManager] ℹ️  Frustum culling temporarily disabled`)
        console.log(`  All visible nodes will be loaded regardless of camera view`)
        console.log(`  This allows data to render while coordinate system is being fixed`)
      }
    }

    // Check if node intersects with spatial bounds filter
    if (!this.nodeIntersectsSpatialBounds(node)) {
      // Outside spatial filter - unload if loaded
      if (node.loaded) {
        this.unloadNode(node)
      }

      // Log node pruning for debugging (only log occasionally to avoid spam)
      if (this.spatialBounds?.enabled && node.depth === 0) {
        const bounds = node.bounds
        const filter = this.spatialBounds
        console.log(`[COPCLODManager] 🚫 ROOT NODE SKIPPED - outside spatial bounds`)
        console.log(`  Node bounds: Lon [${bounds.min.x.toFixed(2)}, ${bounds.max.x.toFixed(2)}], Lat [${bounds.min.y.toFixed(2)}, ${bounds.max.y.toFixed(2)}], Alt [${bounds.min.z.toFixed(2)}, ${bounds.max.z.toFixed(2)}] km`)
        console.log(`  Filter:      Lon [${filter.minLon.toFixed(2)}, ${filter.maxLon.toFixed(2)}], Lat [${filter.minLat.toFixed(2)}, ${filter.maxLat.toFixed(2)}], Alt [${filter.minAlt.toFixed(2)}, ${filter.maxAlt.toFixed(2)}] km`)
        console.log(`  ⚠️  DATA LOCATION MISMATCH! Adjust your filter to include the data region.`)
        console.log(`  💡 HINT: Set Lat to -60 to -50, Alt to 0 to 10 km`)
      }
      return
    }

    // Calculate distance from camera to node center
    const center = new THREE.Vector3()
    node.bounds.getCenter(center)
    const distance = camera.position.distanceTo(center)

    // Determine if we should load this node or traverse to children
    const nodeSize = node.bounds.max.x - node.bounds.min.x
    const shouldRefine = this.shouldRefineNode(node, distance, nodeSize)

    if (shouldRefine && node.depth < 8) { // Max depth limit
      // Try to load children
      const childKeys = this.getChildKeys(node)
      const childrenExist = childKeys.every(key => this.nodes.has(key))

      if (childrenExist) {
        // Try to traverse to children
        let anyChildVisible = false
        for (const childKey of childKeys) {
          const childNode = this.nodes.get(childKey)
          if (childNode) {
            // Check if child would be visible before traversing
            if (frustum.intersectsBox(childNode.bounds) && this.nodeIntersectsSpatialBounds(childNode)) {
              anyChildVisible = true
              break
            }
          }
        }

        // Only traverse children if at least one is potentially visible
        if (anyChildVisible) {
          const pointCountBeforeChildren = this.currentPointCount

          for (const childKey of childKeys) {
            const childNode = this.nodes.get(childKey)
            if (childNode) {
              await this.traverseOctree(childNode, camera, frustum)
            }
          }

          // Only unload parent if at least one child actually loaded
          const childrenLoaded = this.currentPointCount > pointCountBeforeChildren
          if (childrenLoaded && node.loaded) {
            this.unloadNode(node)
            return
          }

          if (childrenLoaded) {
            return // Children loaded, don't load parent
          }
        }
        // If no children are visible, fall through to load parent
      }
    }

    // Load this node if not loaded and within point budget
    if (!node.loaded && this.currentPointCount + node.pointCount <= this.pointBudget) {
      await this.loadNode(node)
    }

    if (node.loaded) {
      this.currentPointCount += node.pointCount
    }
  }

  /**
   * Determine if node should be refined (show children instead)
   */
  private shouldRefineNode(node: COPCNode, distance: number, nodeSize: number): boolean {
    // Screen space error threshold
    // If node is close enough, we want higher detail (children)
    const threshold = nodeSize / distance
    // AGGRESSIVE: Always refine to at least depth 4 to show more data immediately
    if (node.depth < 4) {
      return true // Always refine first 4 levels
    }
    return threshold > 0.1 // Much more aggressive than 0.01
  }

  /**
   * Get child node keys for a given node
   */
  private getChildKeys(node: COPCNode): string[] {
    const childDepth = node.depth + 1
    const childKeys: string[] = []

    for (let dz = 0; dz < 2; dz++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const childKey = `${childDepth}-${node.x * 2 + dx}-${node.y * 2 + dy}-${node.z * 2 + dz}`
          childKeys.push(childKey)
        }
      }
    }

    return childKeys
  }

  /**
   * Load point data for a node
   */
  private async loadNode(node: COPCNode): Promise<void> {
    if (node.loaded) return

    const filteringEnabled = (this.spatialBounds?.enabled || this.heightFilter?.enabled || this.timeRange?.enabled)

    if (filteringEnabled) {
      console.log(`[COPCLODManager] 📦 Loading node ${node.key} (${node.pointCount.toLocaleString()} points) with filters...`)
    } else {
      console.log(`[COPCLODManager] 📦 Loading node ${node.key} (${node.pointCount.toLocaleString()} points)`)
    }

    try {
      // Get the actual node data from hierarchy
      const hierarchyNode = await this.getHierarchyNode(node.key)
      if (!hierarchyNode) {
        console.warn(`[COPCLODManager] Node ${node.key} not found in hierarchy`)
        return
      }

      // Load point data
      const view = await Copc.loadPointDataView(this.getter, this.copc, hierarchyNode)

      // Extract point data
      const count = node.pointCount
      const positions = new Float32Array(count * 3)
      const intensities = new Uint16Array(count)
      const classifications = new Uint8Array(count)
      const gpsTimes = new Float64Array(count)

      // Create getters for dimensions
      const getX = view.getter('X')
      const getY = view.getter('Y')
      const getZ = view.getter('Z')
      const getIntensity = view.getter('Intensity')
      const getClassification = view.getter('Classification')
      const getGpsTime = view.getter('GpsTime')

      // Apply scale and offset from header
      const scale = this.copc.header.scale
      const offset = this.copc.header.offset

      let validPoints = 0

      for (let i = 0; i < count; i++) {
        // Get raw values
        const rawX = getX(i)
        const rawY = getY(i)
        const rawZ = getZ(i)

        // Apply scale and offset
        const x = rawX * scale[0] + offset[0]
        const y = rawY * scale[1] + offset[1]
        const z = rawZ * scale[2] + offset[2]

        // Get GPS time (TAI93 - seconds since 1993-01-01)
        const gpsTime = getGpsTime(i)

        // Apply spatial bounds filter if enabled (additional per-point check)
        if (this.spatialBounds && this.spatialBounds.enabled) {
          if (x < this.spatialBounds.minLon || x > this.spatialBounds.maxLon ||
              y < this.spatialBounds.minLat || y > this.spatialBounds.maxLat ||
              z < this.spatialBounds.minAlt || z > this.spatialBounds.maxAlt) {
            continue // Skip this point
          }
        }

        // Apply height filter if enabled (backward compatibility)
        if (this.heightFilter && this.heightFilter.enabled) {
          if (z < this.heightFilter.min || z > this.heightFilter.max) {
            continue // Skip this point
          }
        }

        // Apply GPS time filter if enabled
        if (this.timeRange && this.timeRange.enabled) {
          if (gpsTime < this.timeRange.minGpsTime || gpsTime > this.timeRange.maxGpsTime) {
            continue // Skip this point
          }
        }

        positions[validPoints * 3] = x
        positions[validPoints * 3 + 1] = y
        positions[validPoints * 3 + 2] = z

        intensities[validPoints] = getIntensity(i)
        classifications[validPoints] = getClassification(i)
        gpsTimes[validPoints] = gpsTime

        validPoints++
      }

      // Trim arrays if points were filtered
      const finalPositions = validPoints < count ? positions.slice(0, validPoints * 3) : positions
      const finalIntensities = validPoints < count ? intensities.slice(0, validPoints) : intensities
      const finalClassifications = validPoints < count ? classifications.slice(0, validPoints) : classifications
      const finalGpsTimes = validPoints < count ? gpsTimes.slice(0, validPoints) : gpsTimes

      // Log filtering statistics
      if (filteringEnabled && validPoints < count) {
        const filteredCount = count - validPoints
        const filterPercent = ((filteredCount / count) * 100).toFixed(1)
        console.log(`[COPCLODManager] ✂️  Point-level filtering applied to node ${node.key}:`)
        console.log(`  • Original points in node: ${count.toLocaleString()}`)
        console.log(`  • Points after filtering:  ${validPoints.toLocaleString()}`)
        console.log(`  • Points filtered out:     ${filteredCount.toLocaleString()} (${filterPercent}%)`)
        console.log(`  ⚡ Only ${validPoints.toLocaleString()} points loaded into memory!`)
      } else if (validPoints === count) {
        console.log(`[COPCLODManager] ✅ Node ${node.key}: All ${validPoints.toLocaleString()} points within filter bounds`)
      }

      // Convert geographic coordinates (lon, lat, alt) to Cartesian (x, y, z) for THREE.js
      const cartesianPositions = new Float32Array(validPoints * 3)

      for (let i = 0; i < validPoints; i++) {
        const lon = finalPositions[i * 3]
        const lat = finalPositions[i * 3 + 1]
        const alt = finalPositions[i * 3 + 2]

        // Use proven coordinate conversion from coordinateConversion.ts
        // Includes: spherical coords, 15x altitude exaggeration, correct Z-axis negation
        const pos = latLonAltToVector3(lat, lon, alt, 15.0)

        cartesianPositions[i * 3] = pos.x
        cartesianPositions[i * 3 + 1] = pos.y
        cartesianPositions[i * 3 + 2] = pos.z
      }

      // Compute colors based on current color mode
      const colors = new Uint8Array(validPoints * 3)
      this.computeColors(finalPositions, finalIntensities, finalClassifications, colors)

      // Store point data (keeping original geographic coords for reference)
      node.pointData = {
        positions: finalPositions, // Original geographic coords
        colors,
        intensities: finalIntensities,
        classifications: finalClassifications,
        gpsTimes: finalGpsTimes
      }

      // Track first and last points for satellite animation (based on GPS time)
      if (finalGpsTimes.length > 0) {
        // Find min and max GPS times in this node
        let minGpsTime = Infinity
        let maxGpsTime = -Infinity
        let minIdx = 0
        let maxIdx = 0

        for (let i = 0; i < finalGpsTimes.length; i++) {
          if (finalGpsTimes[i] < minGpsTime) {
            minGpsTime = finalGpsTimes[i]
            minIdx = i
          }
          if (finalGpsTimes[i] > maxGpsTime) {
            maxGpsTime = finalGpsTimes[i]
            maxIdx = i
          }
        }

        // Update global first point if this is earlier
        if (!this.firstPoint || minGpsTime < this.firstPoint.gpsTime) {
          this.firstPoint = {
            lon: finalPositions[minIdx * 3],
            lat: finalPositions[minIdx * 3 + 1],
            alt: finalPositions[minIdx * 3 + 2],
            gpsTime: minGpsTime
          }
        }

        // Update global last point if this is later
        if (!this.lastPoint || maxGpsTime > this.lastPoint.gpsTime) {
          this.lastPoint = {
            lon: finalPositions[maxIdx * 3],
            lat: finalPositions[maxIdx * 3 + 1],
            alt: finalPositions[maxIdx * 3 + 2],
            gpsTime: maxGpsTime
          }
        }
      }

      // Create Three.js geometry with Cartesian positions
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(cartesianPositions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true)) // normalized

      const material = new THREE.PointsMaterial({
        size: this.pointSize * 0.002, // Scale to match globe size
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
      })

      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false // We handle culling manually

      node.points = points
      node.loaded = true

      // Pause rendering before adding to scene (prevents buffer corruption)
      if (this.pauseRendering) {
        this.pauseRendering()
      }

      // Add to scene
      this.scene.add(points)

      // Resume rendering after adding
      if (this.resumeRendering) {
        this.resumeRendering()
      }

      console.log(`[COPCLODManager] ✨ Node ${node.key} added to scene with ${validPoints.toLocaleString()} points (Cartesian coords)`)
    } catch (error) {
      console.error(`[COPCLODManager] Failed to load node ${node.key}:`, error)
    }
  }

  /**
   * Get hierarchy node data for a given key
   */
  private async getHierarchyNode(key: string): Promise<any> {
    // Re-load the hierarchy to get the actual node object
    // This is needed because copc.js returns node metadata separately
    const { nodes } = await Copc.loadHierarchyPage(
      this.getter,
      this.copc.info.rootHierarchyPage
    )

    return nodes[key]
  }

  /**
   * Unload node from memory and scene
   */
  private unloadNode(node: COPCNode): void {
    if (!node.loaded || !node.points) return

    console.log(`[COPCLODManager] Unloading node ${node.key}`)

    // Pause rendering before removing from scene (prevents buffer corruption)
    if (this.pauseRendering) {
      this.pauseRendering()
    }

    // Remove from scene
    this.scene.remove(node.points)

    // Resume rendering after removing
    if (this.resumeRendering) {
      this.resumeRendering()
    }

    // Dispose geometry and material
    node.points.geometry.dispose()
    if (node.points.material instanceof THREE.Material) {
      node.points.material.dispose()
    }

    // Clear references
    node.points = undefined
    node.pointData = undefined
    node.loaded = false
  }

  /**
   * Compute colors for points based on current color mode
   */
  private computeColors(
    positions: Float32Array,
    intensities: Uint16Array,
    classifications: Uint8Array,
    colors: Uint8Array
  ): void {
    const count = positions.length / 3

    switch (this.colorMode) {
      case 'elevation':
        computeElevationColors(
          positions,
          colors,
          this.dataRange.elevation[0],
          this.dataRange.elevation[1],
          this.colormap
        )
        break

      case 'intensity':
        computeIntensityColors(
          intensities,
          colors,
          this.dataRange.intensity[0],
          this.dataRange.intensity[1],
          this.colormap,
          true // Use CALIPSO scaling
        )
        break

      case 'classification':
        computeClassificationColors(classifications, colors)
        break
    }
  }

  /**
   * Update color mode and recompute all loaded node colors
   */
  setColorMode(mode: 'elevation' | 'intensity' | 'classification', colormap: Colormap): void {
    this.colorMode = mode
    this.colormap = colormap

    // Recompute colors for all loaded nodes
    for (const node of this.nodes.values()) {
      if (node.loaded && node.pointData && node.points) {
        this.computeColors(
          node.pointData.positions,
          node.pointData.intensities,
          node.pointData.classifications,
          node.pointData.colors
        )

        // Update geometry
        const colorAttribute = node.points.geometry.getAttribute('color') as THREE.BufferAttribute
        colorAttribute.needsUpdate = true
      }
    }
  }

  /**
   * Update point size for all loaded nodes
   */
  setPointSize(size: number): void {
    this.pointSize = size

    for (const node of this.nodes.values()) {
      if (node.loaded && node.points) {
        const material = node.points.material
        if (material instanceof THREE.PointsMaterial) {
          material.size = size
        }
      }
    }
  }

  /**
   * Update height filter and reload affected nodes
   */
  setHeightFilter(filter: { enabled: boolean, min: number, max: number } | null): void {
    this.heightFilter = filter

    // Unload all nodes - they will be reloaded with new filter
    for (const node of this.nodes.values()) {
      if (node.loaded) {
        this.unloadNode(node)
      }
    }
  }

  /**
   * Update spatial bounds filter and reload affected nodes
   */
  setSpatialBounds(bounds: SpatialBounds | null): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[COPCLODManager] 📍 SPATIAL BOUNDS FILTER APPLIED')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    if (bounds && bounds.enabled) {
      console.log(`[COPCLODManager] 🔍 Selective loading enabled for file: ${this.filename}`)
      console.log(`[COPCLODManager] 📊 Filter parameters:`)
      console.log(`  • Longitude range: ${bounds.minLon.toFixed(2)}° to ${bounds.maxLon.toFixed(2)}°`)
      console.log(`  • Latitude range:  ${bounds.minLat.toFixed(2)}° to ${bounds.maxLat.toFixed(2)}°`)
      console.log(`  • Altitude range:  ${bounds.minAlt.toFixed(2)} to ${bounds.maxAlt.toFixed(2)} km`)
      console.log(`[COPCLODManager] ⚡ Octree optimization: Only nodes intersecting filter bounds will be loaded`)
      console.log(`[COPCLODManager] 💾 HTTP Range requests will fetch ONLY relevant octree nodes`)
      console.log(`[COPCLODManager] ❌ NOT loading entire file - using COPC octree structure for efficiency`)
    } else {
      console.log(`[COPCLODManager] 📂 Spatial filter disabled - loading all visible data`)
    }

    this.spatialBounds = bounds

    // Unload all nodes - they will be reloaded with new filter
    const unloadedCount = Array.from(this.nodes.values()).filter(n => n.loaded).length
    if (unloadedCount > 0) {
      console.log(`[COPCLODManager] 🔄 Unloading ${unloadedCount} previously loaded nodes to apply new filter`)
    }

    for (const node of this.nodes.values()) {
      if (node.loaded) {
        this.unloadNode(node)
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  }

  /**
   * Update GPS time range filter and reload affected nodes
   */
  setTimeRange(range: TimeRange | null): void {
    this.timeRange = range

    // Unload all nodes - they will be reloaded with new filter
    for (const node of this.nodes.values()) {
      if (node.loaded) {
        this.unloadNode(node)
      }
    }
  }

  /**
   * Update data range for color mapping
   */
  setDataRange(range: { elevation: [number, number], intensity: [number, number] }): void {
    this.dataRange = range
  }

  /**
   * Get data bounds from COPC header
   */
  getDataBounds(): {
    spatial: { minLon: number, maxLon: number, minLat: number, maxLat: number, minAlt: number, maxAlt: number } | null,
    time: { minGpsTime: number, maxGpsTime: number } | null
  } {
    if (!this.copc) {
      return { spatial: null, time: null }
    }

    return {
      spatial: {
        minLon: this.copc.header.min[0],
        maxLon: this.copc.header.max[0],
        minLat: this.copc.header.min[1],
        maxLat: this.copc.header.max[1],
        minAlt: this.copc.header.min[2],
        maxAlt: this.copc.header.max[2]
      },
      time: null // GPS time range not available in header, would need to scan data
    }
  }

  /**
   * Get first point (for satellite animation)
   */
  getFirstPoint(): { lon: number, lat: number, alt: number, gpsTime: number } | null {
    return this.firstPoint
  }

  /**
   * Get last point (for satellite animation)
   */
  getLastPoint(): { lon: number, lat: number, alt: number, gpsTime: number } | null {
    return this.lastPoint
  }

  /**
   * Get current stats
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

  /**
   * Cleanup all resources
   */
  dispose(): void {
    for (const node of this.nodes.values()) {
      if (node.loaded) {
        this.unloadNode(node)
      }
    }

    this.nodes.clear()
    this.rootNode = null
  }
}
