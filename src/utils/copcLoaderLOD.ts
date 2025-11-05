import * as THREE from 'three'
import Copc from 'copc'
import { Colormap } from './colormaps'
import { computeElevationColors, computeIntensityColors, computeClassificationColors } from './copcLoader'

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
  }
}

/**
 * COPC LOD Manager - Handles hierarchical loading of point cloud data
 */
export class COPCLODManager {
  private copc: any
  private filename: string
  private scene: THREE.Scene
  private nodes: Map<string, COPCNode> = new Map()
  private rootNode: COPCNode | null = null
  private pointBudget: number = 2_000_000 // Max points to display
  private currentPointCount: number = 0

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

  constructor(filename: string, scene: THREE.Scene) {
    this.filename = filename
    this.scene = scene
  }

  /**
   * Initialize COPC file and load root hierarchy
   */
  async initialize(): Promise<void> {
    console.log('[COPCLODManager] Initializing COPC file:', this.filename)

    // Create COPC object
    this.copc = await Copc.create(this.filename)

    console.log('[COPCLODManager] COPC Info:', {
      pointCount: this.copc.header.pointCount,
      bounds: this.copc.info.cube,
      spacing: this.copc.info.spacing
    })

    // Load root hierarchy page
    const { nodes, pages } = await Copc.loadHierarchyPage(
      this.filename,
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
  }

  /**
   * Load additional hierarchy page
   */
  private async loadHierarchyPage(pageInfo: any): Promise<void> {
    const { nodes, pages } = await Copc.loadHierarchyPage(
      this.filename,
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
   * Recursively traverse octree and load/unload nodes based on visibility
   */
  private async traverseOctree(
    node: COPCNode,
    camera: THREE.Camera,
    frustum: THREE.Frustum
  ): Promise<void> {
    // Check if node bounds are in frustum
    if (!frustum.intersectsBox(node.bounds)) {
      // Not visible - unload if loaded
      if (node.loaded) {
        this.unloadNode(node)
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
        // Unload this node and traverse children
        if (node.loaded) {
          this.unloadNode(node)
        }

        for (const childKey of childKeys) {
          const childNode = this.nodes.get(childKey)
          if (childNode) {
            await this.traverseOctree(childNode, camera, frustum)
          }
        }
        return
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
    return threshold > 0.01 // Adjust this value to control LOD aggressiveness
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

    console.log(`[COPCLODManager] Loading node ${node.key}, points: ${node.pointCount}`)

    try {
      // Get the actual node data from hierarchy
      const hierarchyNode = await this.getHierarchyNode(node.key)
      if (!hierarchyNode) {
        console.warn(`[COPCLODManager] Node ${node.key} not found in hierarchy`)
        return
      }

      // Load point data
      const view = await Copc.loadPointDataView(this.filename, this.copc, hierarchyNode)

      // Extract point data
      const count = node.pointCount
      const positions = new Float32Array(count * 3)
      const intensities = new Uint16Array(count)
      const classifications = new Uint8Array(count)

      // Create getters for dimensions
      const getX = view.getter('X')
      const getY = view.getter('Y')
      const getZ = view.getter('Z')
      const getIntensity = view.getter('Intensity')
      const getClassification = view.getter('Classification')

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

        // Apply height filter if enabled
        if (this.heightFilter && this.heightFilter.enabled) {
          if (z < this.heightFilter.min || z > this.heightFilter.max) {
            continue // Skip this point
          }
        }

        positions[validPoints * 3] = x
        positions[validPoints * 3 + 1] = y
        positions[validPoints * 3 + 2] = z

        intensities[validPoints] = getIntensity(i)
        classifications[validPoints] = getClassification(i)

        validPoints++
      }

      // Trim arrays if points were filtered
      const finalPositions = validPoints < count ? positions.slice(0, validPoints * 3) : positions
      const finalIntensities = validPoints < count ? intensities.slice(0, validPoints) : intensities
      const finalClassifications = validPoints < count ? classifications.slice(0, validPoints) : classifications

      // Compute colors based on current color mode
      const colors = new Uint8Array(validPoints * 3)
      this.computeColors(finalPositions, finalIntensities, finalClassifications, colors)

      // Store point data
      node.pointData = {
        positions: finalPositions,
        colors,
        intensities: finalIntensities,
        classifications: finalClassifications
      }

      // Create Three.js geometry
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true)) // normalized

      const material = new THREE.PointsMaterial({
        size: this.pointSize,
        vertexColors: true,
        sizeAttenuation: true
      })

      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false // We handle culling manually

      node.points = points
      node.loaded = true

      // Add to scene
      this.scene.add(points)

      console.log(`[COPCLODManager] Loaded node ${node.key}, valid points: ${validPoints}/${count}`)
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
      this.filename,
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

    // Remove from scene
    this.scene.remove(node.points)

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
   * Update data range for color mapping
   */
  setDataRange(range: { elevation: [number, number], intensity: [number, number] }): void {
    this.dataRange = range
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
