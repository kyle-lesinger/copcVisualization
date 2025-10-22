import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { LatLon } from '../utils/aoiSelector'

export interface GlobeViewerHandle {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.Camera | null
  addToScene: (object: THREE.Object3D) => void
  removeFromScene: (object: THREE.Object3D) => void
  getRenderer: () => THREE.WebGLRenderer | null
  getPolygon: () => LatLon[]
  clearPolygon: () => void
  setDrawingMode: (enabled: boolean) => void
  setViewMode: (mode: 'space' | '2d') => void
  animateSatelliteToFirstPoint: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number }, lastPoint: { lon: number, lat: number, alt: number, gpsTime: number }, positions?: Float32Array) => void
}

interface GlobeViewerProps {
  onClick?: (intersectionPoint: THREE.Vector3, event: MouseEvent) => void
  onPolygonComplete?: (polygon: LatLon[]) => void
  onAnimationProgress?: (progress: number) => void
  onCurrentGpsTime?: (gpsTime: number) => void
  onCurrentPosition?: (lat: number, lon: number) => void
}

const GlobeViewer = forwardRef<GlobeViewerHandle, GlobeViewerProps>((props, ref) => {
  const { onClick, onPolygonComplete, onAnimationProgress, onCurrentGpsTime, onCurrentPosition } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const globeRef = useRef<THREE.Mesh | null>(null)
  const satelliteRef = useRef<THREE.Group | null>(null)
  const laserBeamRef = useRef<THREE.Group | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster())

  // Polygon drawing state
  const [isDrawing, setIsDrawing] = useState(false)
  const isDrawingRef = useRef(false)
  const [polygonVertices, setPolygonVertices] = useState<LatLon[]>([])
  const polygonGroupRef = useRef<THREE.Group | null>(null)

  // Helper to convert 3D point to lat/lon
  const point3DToLatLon = (point: THREE.Vector3): LatLon => {
    // Normalize the point (assuming unit sphere with radius 1)
    const normalized = point.clone().normalize()

    // Convert to spherical coordinates
    const lat = Math.asin(normalized.y) * (180 / Math.PI)
    const lon = Math.atan2(-normalized.z, normalized.x) * (180 / Math.PI)

    return { lat, lon }
  }

  // Helper to convert lat/lon to 3D point
  const latLonToPoint3D = (latLon: LatLon, radius: number = 1.0): THREE.Vector3 => {
    const latRad = (latLon.lat * Math.PI) / 180
    const lonRad = (latLon.lon * Math.PI) / 180

    const x = radius * Math.cos(latRad) * Math.cos(lonRad)
    const y = radius * Math.sin(latRad)
    const z = -radius * Math.cos(latRad) * Math.sin(lonRad)

    return new THREE.Vector3(x, y, z)
  }

  // Clear polygon visualization
  const clearPolygonVisualization = () => {
    if (polygonGroupRef.current && sceneRef.current) {
      polygonGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (child.material instanceof THREE.Material) {
            child.material.dispose()
          }
        }
      })
      sceneRef.current.remove(polygonGroupRef.current)
      polygonGroupRef.current = null
    }
  }

  // Clear laser beam visualization
  const clearLaserBeam = () => {
    if (laserBeamRef.current && sceneRef.current) {
      laserBeamRef.current.children.forEach(child => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose()
          if (child.material instanceof THREE.Material) {
            child.material.dispose()
          }
        }
      })
      sceneRef.current.remove(laserBeamRef.current)
      laserBeamRef.current = null
    }
  }

  // Create glowing laser beam from satellite to ground point
  const createLaserBeam = (satellitePos: THREE.Vector3, groundPos: THREE.Vector3) => {
    clearLaserBeam()

    const laserGroup = new THREE.Group()

    // Create multiple overlapping lines for glowing effect
    const points = [satellitePos, groundPos]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    // Core bright laser beam
    const coreMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 3,
      transparent: true,
      opacity: 1.0
    })
    const coreLine = new THREE.Line(geometry.clone(), coreMaterial)
    laserGroup.add(coreLine)

    // Glow layer 1
    const glow1Material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 5,
      transparent: true,
      opacity: 0.5
    })
    const glow1Line = new THREE.Line(geometry.clone(), glow1Material)
    laserGroup.add(glow1Line)

    // Glow layer 2 (outer)
    const glow2Material = new THREE.LineBasicMaterial({
      color: 0x00ff88,
      linewidth: 8,
      transparent: true,
      opacity: 0.2
    })
    const glow2Line = new THREE.Line(geometry.clone(), glow2Material)
    laserGroup.add(glow2Line)

    sceneRef.current?.add(laserGroup)
    laserBeamRef.current = laserGroup
  }

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    getScene: () => sceneRef.current,
    getCamera: () => cameraRef.current,
    getRenderer: () => rendererRef.current,
    addToScene: (object: THREE.Object3D) => {
      if (sceneRef.current) {
        sceneRef.current.add(object)
      }
    },
    removeFromScene: (object: THREE.Object3D) => {
      if (sceneRef.current) {
        sceneRef.current.remove(object)
      }
    },
    getPolygon: () => polygonVertices,
    clearPolygon: () => {
      setPolygonVertices([])
      clearPolygonVisualization()
    },
    setDrawingMode: (enabled: boolean) => {
      setIsDrawing(enabled)
      isDrawingRef.current = enabled
      if (!enabled && polygonVertices.length >= 3) {
        // Complete the polygon
        onPolygonComplete?.(polygonVertices)
      }
    },
    setViewMode: (mode: 'space' | '2d') => {
      if (!cameraRef.current || !controlsRef.current || !globeRef.current) return

      const camera = cameraRef.current
      const controls = controlsRef.current
      const globe = globeRef.current

      if (mode === '2d') {
        // 2D Map view: camera above looking down at flat projection
        camera.position.set(0, 2, 0)         // Above the map
        controls.target.set(0, 0, 0)         // Looking down at center
        // Hide globe completely in 2D mode
        if (globe.material instanceof THREE.MeshPhongMaterial) {
          globe.material.opacity = 0
        }
        globe.visible = false
        // Hide satellite in 2D mode
        if (satelliteRef.current) {
          satelliteRef.current.visible = false
        }
      } else {
        // Space view: default position
        camera.position.set(0, 0, 3)
        controls.target.set(0, 0, 0)
        // Restore globe opacity and visibility
        if (globe.material instanceof THREE.MeshPhongMaterial) {
          globe.material.opacity = 0.95
        }
        globe.visible = true
        // Show satellite in space mode
        if (satelliteRef.current) {
          satelliteRef.current.visible = true
        }
      }

      controls.update()
    },
    animateSatelliteToFirstPoint: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number }, lastPoint: { lon: number, lat: number, alt: number, gpsTime: number }, positions?: Float32Array) => {
      if (!satelliteRef.current || !sceneRef.current) {
        console.warn('Satellite or scene not ready for animation')
        return
      }

      console.log('Starting satellite animation')
      console.log('First point:', firstPoint)
      console.log('Last point:', lastPoint)
      console.log('Positions array provided:', positions ? `yes (${positions.length / 3} points)` : 'no')

      // Cancel any existing animation
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      // Reset animation progress to 0 (hides all points)
      onAnimationProgress?.(0)

      const orbitalRadius = 1.45

      // Move satellite to start position immediately
      const startSatellitePos = latLonToPoint3D({ lat: firstPoint.lat, lon: firstPoint.lon }, orbitalRadius)
      satelliteRef.current.position.copy(startSatellitePos)

      // Clear any existing laser beam
      clearLaserBeam()

      const startTime = Date.now()
      const duration = 5000 // 5 seconds animation (longer to see the curtain effect)

      // Animation loop
      const animate = () => {
        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / duration, 1.0)

        // Linear easing for smoother curtain effect
        const eased = progress

        // Interpolate satellite position in lat/lon space, then convert to 3D
        if (satelliteRef.current) {
          let currentLat, currentLon, currentGpsTime

          if (positions) {
            // Use actual point data - sample the point at the current reveal progress
            const totalPoints = positions.length / 3
            const currentPointIndex = Math.floor(totalPoints * eased)
            const clampedIndex = Math.min(currentPointIndex, totalPoints - 1)

            // Get the actual lat/lon/alt from the sorted positions array
            currentLon = positions[clampedIndex * 3]
            currentLat = positions[clampedIndex * 3 + 1]
            const currentAlt = positions[clampedIndex * 3 + 2]

            // Interpolate GPS time linearly (we don't have individual GPS times per point here)
            currentGpsTime = firstPoint.gpsTime + (lastPoint.gpsTime - firstPoint.gpsTime) * eased

            console.log(`Progress ${(eased * 100).toFixed(1)}%: Point ${currentPointIndex}/${totalPoints}, Lat=${currentLat.toFixed(2)}, Lon=${currentLon.toFixed(2)}`)
          } else {
            // Fallback to simple linear interpolation between first and last points
            currentLat = firstPoint.lat + (lastPoint.lat - firstPoint.lat) * eased
            currentLon = firstPoint.lon + (lastPoint.lon - firstPoint.lon) * eased
            currentGpsTime = firstPoint.gpsTime + (lastPoint.gpsTime - firstPoint.gpsTime) * eased
          }

          // Convert to 3D position at orbital radius
          const currentSatellitePos = latLonToPoint3D({ lat: currentLat, lon: currentLon }, orbitalRadius)
          satelliteRef.current.position.copy(currentSatellitePos)

          // Calculate current ground position
          const currentGroundPos = latLonToPoint3D({ lat: currentLat, lon: currentLon }, 1.0)

          // Update laser beam from satellite to ground
          createLaserBeam(currentSatellitePos, currentGroundPos)

          // Notify parent of progress, GPS time, and current position
          onAnimationProgress?.(progress)
          onCurrentGpsTime?.(currentGpsTime)
          onCurrentPosition?.(currentLat, currentLon)
        }

        if (progress < 1.0) {
          animationFrameRef.current = requestAnimationFrame(animate)
        } else {
          console.log('Animation complete')
          animationFrameRef.current = null
          onAnimationProgress?.(1.0) // Ensure final update
        }
      }

      animate()
    }
  }), [polygonVertices, onPolygonComplete, latLonToPoint3D, createLaserBeam, clearLaserBeam, onAnimationProgress, onCurrentGpsTime, onCurrentPosition])

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Create scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)
    sceneRef.current = scene

    // Create camera with closer near plane for sea-level viewing
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.001, 10000)
    camera.position.set(0, 0, 3)
    cameraRef.current = camera

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    // Add directional light (sun)
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8)
    sunLight.position.set(5, 3, 5)
    scene.add(sunLight)

    // Create Earth globe
    // Earth radius: using 1.0 as base unit (actual radius ~6371 km)
    const earthRadius = 1.0
    const globeGeometry = new THREE.SphereGeometry(earthRadius, 64, 64)

    // Load Earth texture map (NASA Blue Marble)
    const textureLoader = new THREE.TextureLoader()
    const earthTexture = textureLoader.load(
      'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg',
      // onLoad callback
      () => {
        console.log('Earth texture loaded successfully')
      },
      // onProgress callback
      undefined,
      // onError callback
      (error) => {
        console.error('Error loading Earth texture:', error)
      }
    )

    // Earth material with satellite texture
    const globeMaterial = new THREE.MeshPhongMaterial({
      map: earthTexture,
      shininess: 5,
      transparent: true,
      opacity: 0.95
    })

    const globe = new THREE.Mesh(globeGeometry, globeMaterial)
    scene.add(globe)
    globeRef.current = globe

    // Add latitude/longitude grid lines
    const gridRadius = earthRadius + 0.002 // Slightly above surface to prevent z-fighting
    const gridGroup = new THREE.Group()

    // Create latitude lines (parallels)
    const latitudes = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75]
    latitudes.forEach(lat => {
      const latRad = (lat * Math.PI) / 180
      const radius = Math.cos(latRad) * gridRadius
      const y = Math.sin(latRad) * gridRadius

      const segments = 128
      const points: THREE.Vector3[] = []

      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2
        const x = radius * Math.cos(theta)
        const z = radius * Math.sin(theta)
        points.push(new THREE.Vector3(x, y, z))
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: lat === 0 ? 0x888888 : 0x555555, // Equator slightly brighter
        transparent: true,
        opacity: lat === 0 ? 0.5 : 0.3
      })
      const line = new THREE.Line(geometry, material)
      gridGroup.add(line)
    })

    // Create longitude lines (meridians)
    const longitudes = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]
    longitudes.forEach(lon => {
      const lonRad = (lon * Math.PI) / 180
      const segments = 128
      const points: THREE.Vector3[] = []

      for (let i = 0; i <= segments; i++) {
        const phi = (i / segments) * Math.PI // 0 to PI (north to south pole)
        const theta = lonRad

        const x = gridRadius * Math.sin(phi) * Math.cos(theta)
        const y = gridRadius * Math.cos(phi)
        const z = -gridRadius * Math.sin(phi) * Math.sin(theta)
        points.push(new THREE.Vector3(x, y, z))
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: lon === 0 ? 0x888888 : 0x555555, // Prime meridian slightly brighter
        transparent: true,
        opacity: lon === 0 ? 0.5 : 0.3
      })
      const line = new THREE.Line(geometry, material)
      gridGroup.add(line)
    })

    // Helper function to create text sprite
    const createTextSprite = (text: string, fontSize: number = 64) => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!
      canvas.width = 256
      canvas.height = 128

      context.fillStyle = 'rgba(0, 0, 0, 0.6)'
      context.fillRect(0, 0, canvas.width, canvas.height)

      context.font = `bold ${fontSize}px Arial`
      context.fillStyle = 'white'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, canvas.width / 2, canvas.height / 2)

      const texture = new THREE.CanvasTexture(canvas)
      texture.needsUpdate = true

      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.8
      })

      const sprite = new THREE.Sprite(spriteMaterial)
      sprite.scale.set(0.15, 0.075, 1) // Adjust size for readability

      return sprite
    }

    // Add labels at major lat/lon intersections
    const labelLatitudes = [-60, -30, 0, 30, 60]
    const labelLongitudes = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]

    labelLatitudes.forEach(lat => {
      labelLongitudes.forEach(lon => {
        const latRad = (lat * Math.PI) / 180
        const lonRad = (lon * Math.PI) / 180
        const labelRadius = gridRadius + 0.05 // Further from surface for visibility

        // Calculate 3D position
        const x = labelRadius * Math.cos(latRad) * Math.cos(lonRad)
        const y = labelRadius * Math.sin(latRad)
        const z = -labelRadius * Math.cos(latRad) * Math.sin(lonRad)

        const label = createTextSprite(`${lat}°, ${lon}°`, 48)
        label.position.set(x, y, z)
        gridGroup.add(label)
      })
    })

    scene.add(gridGroup)

    // Add orbit controls - allow very close zoom for sea-level viewing
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.minDistance = 0.01 // Allow zooming very close to see curtain details
    controls.maxDistance = 10
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.5
    controlsRef.current = controls

    // Animation loop
    let animationFrameId: number
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Handle window resize
    const handleResize = () => {
      const newWidth = container.clientWidth
      const newHeight = container.clientHeight

      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', handleResize)

    // Handle click for raycasting and polygon drawing
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouse, camera)

      // Check intersections with globe
      if (globeRef.current) {
        const intersects = raycasterRef.current.intersectObject(globeRef.current)

        if (intersects.length > 0 && isDrawingRef.current) {
          // Drawing mode: add vertex to polygon
          const point = intersects[0].point
          const latLon = point3DToLatLon(point)

          setPolygonVertices(prev => [...prev, latLon])
          return
        }
      }

      // Regular point cloud click handling
      if (!onClick) return

      // Check intersections with all objects in the scene
      const intersects = raycasterRef.current.intersectObjects(scene.children, true)

      // Only trigger onClick if we hit a Points object (point cloud data), not the globe mesh
      const pointCloudIntersection = intersects.find(intersection => intersection.object instanceof THREE.Points)

      if (pointCloudIntersection) {
        onClick(pointCloudIntersection.point, event)
      }
    }
    renderer.domElement.addEventListener('click', handleClick)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.domElement.removeEventListener('click', handleClick)
      cancelAnimationFrame(animationFrameId)

      controls.dispose()
      renderer.dispose()
      globeGeometry.dispose()
      globeMaterial.dispose()

      // Dispose grid lines and labels
      gridGroup.children.forEach(child => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose()
          if (child.material instanceof THREE.Material) {
            child.material.dispose()
          }
        } else if (child instanceof THREE.Sprite) {
          if (child.material instanceof THREE.SpriteMaterial) {
            if (child.material.map) {
              child.material.map.dispose()
            }
            child.material.dispose()
          }
        }
      })

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
    // Note: onClick is intentionally omitted from deps - it's stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Visualize polygon as vertices are added
  useEffect(() => {
    if (!sceneRef.current || polygonVertices.length === 0) return

    // Clear existing visualization
    clearPolygonVisualization()

    // Create new polygon group
    const polygonGroup = new THREE.Group()
    polygonGroupRef.current = polygonGroup

    const radius = 1.004 // Slightly above globe surface

    // Draw lines connecting vertices
    if (polygonVertices.length >= 2) {
      const points: THREE.Vector3[] = []

      polygonVertices.forEach(vertex => {
        points.push(latLonToPoint3D(vertex, radius))
      })

      // Close the polygon if we have 3+ vertices
      if (polygonVertices.length >= 3) {
        points.push(latLonToPoint3D(polygonVertices[0], radius))
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 2,
        transparent: true,
        opacity: 0.8
      })

      const line = new THREE.Line(geometry, material)
      polygonGroup.add(line)
    }

    // Draw vertex markers
    polygonVertices.forEach(vertex => {
      const position = latLonToPoint3D(vertex, radius)
      const sphereGeometry = new THREE.SphereGeometry(0.01, 8, 8)
      const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 })
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
      sphere.position.copy(position)
      polygonGroup.add(sphere)
    })

    sceneRef.current.add(polygonGroup)

    return () => {
      clearPolygonVisualization()
    }
  }, [polygonVertices])

  // Load satellite 3D model
  useEffect(() => {
    if (!sceneRef.current) return

    const loader = new GLTFLoader()

    loader.load(
      '/Landsat 1, 2, and 3.glb',
      // onLoad callback
      (gltf) => {
        console.log('Satellite model loaded successfully')
        const satellite = gltf.scene

        // Scale down the satellite (GLB models are often large)
        // Adjust this value based on how the model looks
        satellite.scale.set(0.01, 0.01, 0.01)

        // Position satellite in Low Earth Orbit (LEO)
        // Landsat orbits at ~700km altitude, Earth radius is 1.0 in our units
        // So orbital radius should be approximately 1.11 (1 + 700/6371)
        const orbitalRadius = 1.45
        satellite.position.set(orbitalRadius, 0, 0)

        // Add to scene
        sceneRef.current?.add(satellite)
        satelliteRef.current = satellite

        console.log('Satellite added to scene at position:', satellite.position)
      },
      // onProgress callback
      (progress) => {
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total) * 100
          console.log(`Loading satellite model: ${percent.toFixed(1)}%`)
        }
      },
      // onError callback
      (error) => {
        console.error('Error loading satellite model:', error)
      }
    )

    // Cleanup
    return () => {
      if (satelliteRef.current && sceneRef.current) {
        sceneRef.current.remove(satelliteRef.current)

        // Dispose of geometry and materials
        satelliteRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose())
            } else {
              child.material.dispose()
            }
          }
        })

        satelliteRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    />
  )
})

GlobeViewer.displayName = 'GlobeViewer'

export default GlobeViewer
