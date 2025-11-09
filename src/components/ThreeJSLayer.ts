import * as THREE from 'three'
import maplibregl from 'maplibre-gl'
import { PointCloudData } from '../utils/copcLoader'
import { ColorMode, Colormap } from '../App'

interface ThreeJSLayerOptions {
  data: PointCloudData[]
  colorMode: ColorMode
  colormap: Colormap
  pointSize: number
}

export class ThreeJSLayer implements maplibregl.CustomLayerInterface {
  id: string
  type: 'custom' = 'custom'
  renderingMode: '3d' = '3d'

  private map?: maplibregl.Map
  private scene?: THREE.Scene
  private camera?: THREE.Camera
  private renderer?: THREE.WebGLRenderer
  private pointClouds: THREE.Points[] = []

  private options: ThreeJSLayerOptions
  private modelTransform?: {
    translateX: number
    translateY: number
    translateZ: number
    scale: number
  }
  private currentZoom: number = 0
  private lastLODUpdate: number = 0

  constructor(id: string, options: ThreeJSLayerOptions) {
    this.id = id
    this.options = options
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    console.log('[ThreeJSLayer] onAdd called, data count:', this.options.data.length)
    this.map = map

    // Create Three.js scene
    this.scene = new THREE.Scene()

    // Create Three.js camera (will be synced with map camera)
    this.camera = new THREE.Camera()

    // Create Three.js renderer using MapLibre's WebGL context
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGLRenderingContext,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false
    })

    // Prevent Three.js from clearing the buffer (map already rendered)
    this.renderer.autoClear = false
    this.renderer.autoClearColor = false
    this.renderer.autoClearDepth = false
    this.renderer.autoClearStencil = false

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    this.scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4)
    directionalLight.position.set(0, -70, 100).normalize()
    this.scene.add(directionalLight)

    console.log('[ThreeJSLayer] Creating point clouds...')
    // Process point cloud data
    this.createPointClouds()
  }

  /**
   * Get optimal subsample rate based on current zoom level
   */
  private getSubsampleRate(): number {
    const zoom = this.map?.getZoom() || 0

    // More points at higher zoom levels
    if (zoom < 4) return 1000      // ~460 points - far away
    if (zoom < 6) return 500       // ~920 points
    if (zoom < 8) return 200       // ~2,300 points
    if (zoom < 10) return 100      // ~4,600 points
    if (zoom < 12) return 50       // ~9,200 points
    if (zoom < 14) return 20       // ~23,000 points
    if (zoom < 16) return 10       // ~46,000 points
    return 5                        // ~92,000 points - zoomed in close
  }

  private createPointClouds() {
    if (!this.scene || this.options.data.length === 0) return

    // Store current zoom for LOD tracking
    this.currentZoom = this.map?.getZoom() || 0

    // Calculate data center for reference (only on first creation)
    if (!this.modelTransform) {
      const firstData = this.options.data[0]
      let minLng = Infinity, maxLng = -Infinity
      let minLat = Infinity, maxLat = -Infinity

      for (let i = 0; i < firstData.positions.length; i += 3) {
        const lon = firstData.positions[i]
        const lat = firstData.positions[i + 1]
        minLng = Math.min(minLng, lon)
        maxLng = Math.max(maxLng, lon)
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
      }

      const centerLng = (minLng + maxLng) / 2
      const centerLat = (minLat + maxLat) / 2

      console.log('[ThreeJSLayer] Data center:', { lng: centerLng, lat: centerLat })

      // Get the MercatorCoordinate for the center point
      const centerMerc = maplibregl.MercatorCoordinate.fromLngLat(
        { lng: centerLng, lat: centerLat },
        0
      )

      // Store for later use
      this.modelTransform = {
        translateX: centerMerc.x,
        translateY: centerMerc.y,
        translateZ: centerMerc.z || 0,
        scale: centerMerc.meterInMercatorCoordinateUnits()
      }

      console.log('[ThreeJSLayer] Center Mercator coords:', this.modelTransform)
    }

    // Get subsample rate based on zoom level
    const subsampleRate = this.getSubsampleRate()
    console.log(`[ThreeJSLayer] Creating point clouds at zoom ${this.currentZoom.toFixed(1)}, subsample rate: ${subsampleRate}`)

    // Create point clouds for each data file
    this.options.data.forEach((data, dataIndex) => {
      const positions: number[] = []
      const colors: number[] = []

      console.log(`[ThreeJSLayer] Processing data file ${dataIndex}, points: ${data.positions.length / 3}`)

      // Convert each point to RELATIVE Mercator coordinates
      // Subsample based on zoom level for better performance
      for (let i = 0; i < data.positions.length; i += 3) {
        // Skip points based on subsample rate
        if ((i / 3) % subsampleRate !== 0) continue

        const lon = data.positions[i]
        const lat = data.positions[i + 1]
        const alt = data.positions[i + 2] // altitude in km

        // Convert to Mercator coordinates at altitude
        const merc = maplibregl.MercatorCoordinate.fromLngLat(
          { lng: lon, lat: lat },
          alt * 1000 // convert km to meters
        )

        // Position RELATIVE to center in Mercator space
        const relX = merc.x - this.modelTransform!.translateX
        const relY = merc.y - this.modelTransform!.translateY
        const relZ = (merc.z || 0) - this.modelTransform!.translateZ

        positions.push(relX, relY, relZ)

        // Also subsample the colors to match the subsampled positions
        const colorIndex = i
        colors.push(
          data.colors[colorIndex] / 255,     // R (normalize to 0-1)
          data.colors[colorIndex + 1] / 255, // G (normalize to 0-1)
          data.colors[colorIndex + 2] / 255  // B (normalize to 0-1)
        )
      }

      console.log(`[ThreeJSLayer] Subsampled to ${positions.length / 3} points from ${data.positions.length / 3}`)

      // Create Three.js geometry
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.computeBoundingBox()

      const material = new THREE.PointsMaterial({
        size: this.options.pointSize * 10,
        vertexColors: true,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
      })

      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false
      this.scene?.add(points)
      this.pointClouds.push(points)
    })

    console.log(`[ThreeJSLayer] Created ${this.pointClouds.length} point clouds, total points: ${this.pointClouds.reduce((sum, pc) => sum + pc.geometry.attributes.position.count, 0)}`)

    this.map?.triggerRepaint()
  }

  /**
   * Update LOD if zoom level has changed significantly
   */
  private updateLOD() {
    if (!this.map) return

    const currentZoom = this.map.getZoom()
    const zoomDelta = Math.abs(currentZoom - this.currentZoom)

    // Update LOD if zoom changed by more than 1.5 levels
    if (zoomDelta > 1.5) {
      const now = Date.now()

      // Throttle updates to every 500ms
      if (now - this.lastLODUpdate > 500) {
        console.log(`[ThreeJSLayer] LOD update triggered: zoom ${this.currentZoom.toFixed(1)} -> ${currentZoom.toFixed(1)}`)

        // Clear existing point clouds
        this.pointClouds.forEach(pc => {
          this.scene?.remove(pc)
          pc.geometry.dispose()
          if (pc.material instanceof THREE.Material) {
            pc.material.dispose()
          }
        })
        this.pointClouds = []

        // Recreate with new LOD level
        this.createPointClouds()

        this.lastLODUpdate = now
      }
    }
  }

  private renderCount = 0

  render(_gl: WebGLRenderingContext, matrix: any) {
    if (!this.map || !this.scene || !this.camera || !this.renderer || !this.modelTransform) {
      if (this.renderCount === 0) {
        console.log('[ThreeJSLayer] Render skipped - missing:', {
          map: !!this.map,
          scene: !!this.scene,
          camera: !!this.camera,
          renderer: !!this.renderer,
          modelTransform: !!this.modelTransform
        })
      }
      return
    }

    if (this.pointClouds.length === 0) {
      if (this.renderCount === 0) {
        console.log('[ThreeJSLayer] Render skipped - no point clouds')
      }
      return
    }

    const isFirstRender = this.renderCount === 0
    this.renderCount++

    if (isFirstRender) {
      console.log('[ThreeJSLayer] First render! Point clouds:', this.pointClouds.length)
    }

    // Update LOD based on zoom level
    this.updateLOD()

    try {
      // Sync Three.js camera with MapLibre's camera
      // MapLibre v5+ provides matrix as an object with properties
      let matrixArray: number[]

      if (matrix.projectionMatrix) {
        matrixArray = Array.from(matrix.projectionMatrix) as number[]
      } else if (Array.isArray(matrix) || matrix.length) {
        // Fallback for older MapLibre versions (v4 and earlier)
        matrixArray = Array.from(matrix) as number[]
      } else {
        console.error('[ThreeJSLayer] Cannot extract matrix from:', matrix)
        return
      }

      const m = new THREE.Matrix4().fromArray(matrixArray)

      // Create transformation matrix for our model
      // Translate to the model's position in Mercator space (exactly like copcViz)
      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(
          this.modelTransform.translateX,
          this.modelTransform.translateY,
          this.modelTransform.translateZ
        )

      // Combine map's projection with our model transformation (exactly like copcViz)
      this.camera.projectionMatrix = m.multiply(modelMatrix)
      this.camera.matrixWorldInverse = new THREE.Matrix4() // Identity matrix

      if (isFirstRender) {
        console.log('[ThreeJSLayer] First render setup:')
        console.log('  Point clouds:', this.pointClouds.length)
        console.log('  Total points:', this.pointClouds[0]?.geometry.attributes.position.count)
        console.log('  Map pitch:', this.map.getPitch(), 'zoom:', this.map.getZoom())
      }

      // Reset THREE.js renderer state to avoid conflicts with MapLibre
      this.renderer.resetState()

      // Render the scene
      this.renderer.render(this.scene, this.camera)
    } catch (err) {
      console.error('[ThreeJSLayer] Render error:', err)
    }
  }

  onRemove() {
    // Cleanup Three.js resources
    this.pointClouds.forEach(points => {
      points.geometry.dispose()
      if (Array.isArray(points.material)) {
        points.material.forEach(m => m.dispose())
      } else {
        points.material.dispose()
      }
    })
    this.pointClouds = []
  }

  // Public methods to update the layer
  updatePointSize(size: number) {
    this.options.pointSize = size
    this.pointClouds.forEach(points => {
      if (points.material instanceof THREE.PointsMaterial) {
        points.material.size = size * 5 // Match the scale used during creation
      }
    })
    this.map?.triggerRepaint()
  }

  updateColors(data: PointCloudData[]) {
    // Update colors for existing point clouds
    data.forEach((d, index) => {
      if (this.pointClouds[index]) {
        const colorAttribute = this.pointClouds[index].geometry.getAttribute('color') as THREE.BufferAttribute
        colorAttribute.array = d.colors
        colorAttribute.needsUpdate = true
      }
    })
    this.map?.triggerRepaint()
  }
}
