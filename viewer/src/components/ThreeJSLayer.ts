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

  private createPointClouds() {
    if (!this.scene || this.options.data.length === 0) return

    // Calculate data center for reference
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

    // Get the MercatorCoordinate for the center point (for test sphere)
    const centerMerc = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: centerLng, lat: centerLat },
      0
    )

    // Store for later use (no longer applying as transform)
    this.modelTransform = {
      translateX: centerMerc.x,
      translateY: centerMerc.y,
      translateZ: centerMerc.z || 0,
      scale: centerMerc.meterInMercatorCoordinateUnits()
    }

    console.log('[ThreeJSLayer] Center Mercator coords:', this.modelTransform)

    // Create point clouds for each data file
    this.options.data.forEach((data, dataIndex) => {
      const positions: number[] = []

      console.log(`[ThreeJSLayer] Processing data file ${dataIndex}, points: ${data.positions.length / 3}`)

      // Convert each point to RELATIVE Mercator coordinates (like copcViz)
      // Subsample for better performance (render every Nth point)
      const subsampleRate = 100 // Render 1 out of every 100 points (~46k points)
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

        // Position RELATIVE to center in Mercator space (like copcViz)
        const relX = merc.x - centerMerc.x
        const relY = merc.y - centerMerc.y
        const relZ = (merc.z || 0) - (centerMerc.z || 0)

        positions.push(relX, relY, relZ)
      }

      console.log(`[ThreeJSLayer] Sample relative Mercator positions:`, positions.slice(0, 9))

      // Create Three.js geometry
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true))
      geometry.computeBoundingBox()

      console.log(`[ThreeJSLayer] Bounding box:`, geometry.boundingBox)

      if (geometry.boundingBox) {
        const min = geometry.boundingBox.min
        const max = geometry.boundingBox.max
        console.log(`[ThreeJSLayer] Bounding box details:`)
        console.log(`  X range: ${min.x} to ${max.x} (width: ${max.x - min.x})`)
        console.log(`  Y range: ${min.y} to ${max.y} (height: ${max.y - min.y})`)
        console.log(`  Z range: ${min.z} to ${max.z} (depth: ${max.z - min.z})`)
      }

      const material = new THREE.PointsMaterial({
        size: this.options.pointSize * 10, // Even larger for debugging
        vertexColors: true,
        sizeAttenuation: false, // Use fixed screen-space size
        depthTest: false, // TEMP: Disable to rule out depth issues
        depthWrite: false,
        transparent: true,
        opacity: 0.9
      })

      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false // Disable frustum culling - we're using MapLibre's camera
      this.scene?.add(points)
      this.pointClouds.push(points)
    })

    console.log(`[ThreeJSLayer] Created ${this.pointClouds.length} point clouds, total points: ${this.pointClouds.reduce((sum, pc) => sum + pc.geometry.attributes.position.count, 0)}`)

    this.map?.triggerRepaint()
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
