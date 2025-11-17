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
  getCameraState: () => { distance: number, target: { lon: number, lat: number } } | null
  setCameraState: (distance: number, target: { lon: number, lat: number }) => void
  pauseRendering: () => void
  resumeRendering: () => void
}

interface GlobeViewerProps {
  onClick?: (intersectionPoint: THREE.Vector3, event: MouseEvent) => void
  onPolygonComplete?: (polygon: LatLon[]) => void
  onAnimationProgress?: (progress: number) => void
  onCurrentGpsTime?: (gpsTime: number) => void
  onCurrentPosition?: (lat: number, lon: number) => void
  initialCameraState?: { distance: number, target: { lon: number, lat: number } }
  isGroundModeActive?: boolean
  groundCameraPosition?: { lat: number, lon: number } | null
  onGroundCameraPositionSet?: (lat: number, lon: number) => void
}

const GlobeViewer = forwardRef<GlobeViewerHandle, GlobeViewerProps>((props, ref) => {
  const { onClick, onPolygonComplete, onAnimationProgress, onCurrentGpsTime, onCurrentPosition, initialCameraState, isGroundModeActive = false, groundCameraPosition: groundCameraPositionProp, onGroundCameraPositionSet } = props
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
  const renderEnabledRef = useRef<boolean>(true) // Control rendering during geometry updates
  const lastCameraLogTimeRef = useRef<number>(0) // Throttle camera state logging

  // Polygon drawing state
  const [isDrawing, setIsDrawing] = useState(false)
  const isDrawingRef = useRef(false)
  const [polygonVertices, setPolygonVertices] = useState<LatLon[]>([])
  const [completedPolygon, setCompletedPolygon] = useState<LatLon[] | null>(null)
  const polygonGroupRef = useRef<THREE.Group | null>(null)
  const onPolygonCompleteRef = useRef(onPolygonComplete)

  // Ground mode marker ref
  const groundMarkerRef = useRef<THREE.Group | null>(null)

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
  const latLonToPoint3D = (latLon: LatLon, radius: number = 1000.0): THREE.Vector3 => {
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

  // Clear ground camera marker
  const clearGroundMarker = () => {
    if (groundMarkerRef.current && sceneRef.current) {
      groundMarkerRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (child.material instanceof THREE.Material) {
            child.material.dispose()
          }
        }
      })
      sceneRef.current.remove(groundMarkerRef.current)
      groundMarkerRef.current = null
    }
  }

  // Create ground camera marker at specified position
  const createGroundMarker = (lat: number, lon: number) => {
    clearGroundMarker()

    const markerGroup = new THREE.Group()
    const position = latLonToPoint3D({ lat, lon }, 1010.0) // Slightly above globe surface (scaled for 1000x Earth radius)

    // Create a cone marker pointing up (scaled for 1000x Earth radius)
    const coneGeometry = new THREE.ConeGeometry(20, 50, 8)
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.9
    })
    const cone = new THREE.Mesh(coneGeometry, coneMaterial)

    // Orient the cone to point away from globe center (up)
    cone.position.copy(position)
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      position.clone().normalize()
    )

    markerGroup.add(cone)

    // Add a small sphere at the base (scaled for 1000x Earth radius)
    const sphereGeometry = new THREE.SphereGeometry(15, 16, 16)
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.9
    })
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.copy(position)
    markerGroup.add(sphere)

    sceneRef.current?.add(markerGroup)
    groundMarkerRef.current = markerGroup
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
      setCompletedPolygon(null)
      clearPolygonVisualization()
    },
    setDrawingMode: (enabled: boolean) => {
      console.log(`[GlobeViewer] Setting drawing mode: ${enabled}`)
      setIsDrawing(enabled)
      isDrawingRef.current = enabled

      if (!enabled) {
        // User clicked "Finish AOI" - complete the polygon if we have at least 3 vertices
        if (polygonVertices.length >= 3) {
          console.log(`[GlobeViewer] Completing polygon with ${polygonVertices.length} vertices`)
          setCompletedPolygon(polygonVertices) // Keep the polygon highlighted
          onPolygonCompleteRef.current?.(polygonVertices)
          setPolygonVertices([]) // Clear drawing vertices but keep completed polygon
        } else if (polygonVertices.length > 0) {
          console.log(`[GlobeViewer] Not enough vertices (${polygonVertices.length}), need at least 3`)
        }
      } else {
        // Starting new drawing - clear any existing vertices and completed polygon
        setPolygonVertices([])
        setCompletedPolygon(null)
        clearPolygonVisualization()
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
        // Space view: restore visibility without changing camera position
        // (camera position is set during initialization or preserved from previous state)
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
      if (!satelliteRef.current || !sceneRef.current || !controlsRef.current) {
        console.warn('Satellite or scene not ready for animation')
        return
      }

      // Cancel any existing animation
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      // Disable OrbitControls during animation to prevent camera drift
      const controls = controlsRef.current
      controls.enabled = false
      console.log('[GlobeViewer] 🔒 OrbitControls disabled for animation')

      // Reset animation progress to 0 (hides all points)
      onAnimationProgress?.(0)

      const orbitalRadius = 1450.0 // Scaled for 1000x Earth radius

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
          const currentGroundPos = latLonToPoint3D({ lat: currentLat, lon: currentLon }, 1000.0)

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

          // Re-enable OrbitControls after animation completes
          if (controlsRef.current) {
            controlsRef.current.enabled = true
            console.log('[GlobeViewer] 🔓 OrbitControls re-enabled')
          }
        }
      }

      animate()
    },
    getCameraState: () => {
      if (!cameraRef.current || !controlsRef.current) return null

      const camera = cameraRef.current
      const controls = controlsRef.current
      const distance = camera.position.length()

      // Get the target (where camera is looking at) and convert to lat/lon
      const target = controls.target.clone().normalize()
      const targetLatLon = point3DToLatLon(target)

      // ==================== GET CAMERA STATE LOGGING - COMMENTED OUT ====================
      // Throttle logging to once every 5 seconds
      // const now = Date.now()
      // if (now - lastCameraLogTimeRef.current >= 5000) {
      //   lastCameraLogTimeRef.current = now

      //   // Convert camera position to spherical coordinates for clarity
      //   const camLatRad = Math.asin(camera.position.y / distance)
      //   const camLonRad = Math.atan2(-camera.position.z, camera.position.x)
      //   const camLatDeg = camLatRad * (180 / Math.PI)
      //   const camLonDeg = camLonRad * (180 / Math.PI)

      //   console.log('📸 GET Camera State:')
      //   console.log('   Camera Position (Cartesian):')
      //   console.log(`      x: ${camera.position.x.toFixed(4)} (East/West)`)
      //   console.log(`      y: ${camera.position.y.toFixed(4)} (Up/Down)`)
      //   console.log(`      z: ${camera.position.z.toFixed(4)} (North/South)`)
      //   console.log('   Camera Position (Geographic):')
      //   console.log(`      Latitude:  ${camLatDeg.toFixed(4)}°`)
      //   console.log(`      Longitude: ${camLonDeg.toFixed(4)}°`)
      //   console.log(`      Distance:  ${distance.toFixed(4)}`)
      //   console.log('   Target:')
      //   console.log(`      Cartesian: (${controls.target.x.toFixed(4)}, ${controls.target.y.toFixed(4)}, ${controls.target.z.toFixed(4)})`)
      //   console.log(`      Lat/Lon: (${targetLatLon.lat.toFixed(4)}°, ${targetLatLon.lon.toFixed(4)}°)`)
      // }

      return {
        distance,
        target: { lon: targetLatLon.lon, lat: targetLatLon.lat }
      }
    },
    setCameraState: (distance: number, target: { lon: number, lat: number }) => {
      if (!cameraRef.current || !controlsRef.current) return

      const camera = cameraRef.current
      const controls = controlsRef.current

      // ==================== CAMERA STATE UPDATE - COMMENTED OUT ====================
      // console.log('==================== CAMERA STATE UPDATE ====================')
      // console.log('📍 Input Parameters:')
      // console.log(`   Distance: ${distance.toFixed(4)}`)
      // console.log(`   Target Lat/Lon: (${target.lat.toFixed(4)}°, ${target.lon.toFixed(4)}°)`)

      // Convert target lat/lon to 3D point
      const targetPoint = latLonToPoint3D(target, 1000.0)
      // console.log(`   Target 3D Point: (${targetPoint.x.toFixed(4)}, ${targetPoint.y.toFixed(4)}, ${targetPoint.z.toFixed(4)})`)
      controls.target.copy(targetPoint)

      // Position camera using spherical coordinates relative to target
      // Elevation: vertical angle above horizon (0° = on horizon, 90° = directly above)
      // Azimuth: horizontal rotation around target (0° = north, 90° = east, 180° = south, 270° = west)
      const elevationDegrees = 0  // Angle above target's horizon
      const azimuthDegrees = 90    // Rotation around target (0° = due north of target)

      const elevationRad = elevationDegrees * (Math.PI / 180)
      const azimuthRad = azimuthDegrees * (Math.PI / 180)

      // console.log('📐 Camera Positioning (Spherical Coordinates):')
      // console.log(`   Elevation: ${elevationDegrees}° (angle above horizon)`)
      // console.log(`   Azimuth:   ${azimuthDegrees}° (rotation around target, 0°=North)`)
      // console.log(`   Distance:  ${distance.toFixed(4)}`)

      // Convert target to 3D point (already done above, but for clarity)
      const targetPos = targetPoint

      // Calculate camera offset from target in spherical coordinates
      // Using a local coordinate frame centered at the target

      // Get "up" direction at target (radial direction from Earth center)
      const up = targetPos.clone().normalize()

      // Get "north" direction at target (tangent to meridian)
      const north = new THREE.Vector3(0, 1, 0).cross(up).cross(up).normalize()
      if (north.length() < 0.1) {
        // Near poles, use a different reference
        north.set(0, 0, 1).cross(up).normalize()
      }

      // Get "east" direction at target
      const east = up.clone().cross(north).normalize()

      // Calculate camera offset in local frame
      const horizontalDist = distance * Math.cos(elevationRad)
      const verticalDist = distance * Math.sin(elevationRad)

      // Offset in local coordinates
      const offsetNorth = horizontalDist * Math.cos(azimuthRad)
      const offsetEast = horizontalDist * Math.sin(azimuthRad)
      const offsetUp = verticalDist

      // console.log('   Offset from target (local frame):')
      // console.log(`      North: ${offsetNorth.toFixed(4)}`)
      // console.log(`      East:  ${offsetEast.toFixed(4)}`)
      // console.log(`      Up:    ${offsetUp.toFixed(4)}`)

      // Convert to world coordinates
      const cameraOffset = new THREE.Vector3()
      cameraOffset.addScaledVector(north, offsetNorth)
      cameraOffset.addScaledVector(east, offsetEast)
      cameraOffset.addScaledVector(up, offsetUp)

      const cameraPosition = targetPos.clone().add(cameraOffset)

      // console.log('📷 Final Camera Position (Cartesian):')
      // console.log(`   x: ${cameraPosition.x.toFixed(4)} (East/West component)`)
      // console.log(`   y: ${cameraPosition.y.toFixed(4)} (Up/Down component - elevation)`)
      // console.log(`   z: ${cameraPosition.z.toFixed(4)} (North/South component)`)

      camera.position.copy(cameraPosition)

      controls.update()

      // Convert camera position back to spherical for verification
      const camDist = camera.position.length()
      const camLatRad = Math.asin(camera.position.y / camDist)
      const camLonRad = Math.atan2(-camera.position.z, camera.position.x)
      const camLatDeg = camLatRad * (180 / Math.PI)
      const camLonDeg = camLonRad * (180 / Math.PI)

      // Calculate viewing angle/direction
      const viewDirection = new THREE.Vector3().subVectors(controls.target, camera.position).normalize()
      const viewDown = Math.asin(-viewDirection.y) * (180 / Math.PI) // Angle looking down from horizontal

      // Log final state after update
      // console.log('✅ Controls Updated:')
      // console.log(`   Controls target (Cartesian): (${controls.target.x.toFixed(4)}, ${controls.target.y.toFixed(4)}, ${controls.target.z.toFixed(4)})`)
      // console.log(`   Camera position (Cartesian): (${camera.position.x.toFixed(4)}, ${camera.position.y.toFixed(4)}, ${camera.position.z.toFixed(4)})`)
      // console.log('')
      // console.log('📍 Camera Position (Geographic):')
      // console.log(`   Camera Latitude:  ${camLatDeg.toFixed(4)}°`)
      // console.log(`   Camera Longitude: ${camLonDeg.toFixed(4)}°`)
      // console.log(`   Camera Distance:  ${camDist.toFixed(4)}`)
      // console.log('')
      // console.log('👁️  Viewing Direction:')
      // console.log(`   Looking ${viewDown >= 0 ? 'down' : 'up'} at ${Math.abs(viewDown).toFixed(2)}° from horizontal`)
      // console.log(`   View vector: (${viewDirection.x.toFixed(4)}, ${viewDirection.y.toFixed(4)}, ${viewDirection.z.toFixed(4)})`)
      // console.log('============================================================')
    },
    pauseRendering: () => {
      renderEnabledRef.current = false
      console.log('[GlobeViewer] ⏸️  Rendering paused for geometry update')
    },
    resumeRendering: () => {
      renderEnabledRef.current = true
      console.log('[GlobeViewer] ▶️  Rendering resumed')
    }
  }), [polygonVertices, completedPolygon, onPolygonComplete, latLonToPoint3D, createLaserBeam, clearLaserBeam, onAnimationProgress, onCurrentGpsTime, onCurrentPosition, point3DToLatLon])

  // Keep ref in sync with prop
  useEffect(() => {
    onPolygonCompleteRef.current = onPolygonComplete
  }, [onPolygonComplete])

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
    // Far plane increased to 10000000 to accommodate 1000x scaled scene
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.001, 10000000)

    console.log('🎬 ==================== INITIAL CAMERA SETUP ====================')
    console.log(`   FOV: 45°, Aspect: ${(width / height).toFixed(4)}, Near: 0.001, Far: 10000000`)

    // Set initial camera position from prop or use default
    if (initialCameraState) {
      console.log('📍 Setting up camera with initial state:')
      console.log(`   Distance: ${initialCameraState.distance.toFixed(4)}`)
      console.log(`   Target Lat/Lon: (${initialCameraState.target.lat.toFixed(4)}°, ${initialCameraState.target.lon.toFixed(4)}°)`)

      const targetPoint = latLonToPoint3D(initialCameraState.target, 1000.0)
      console.log(`   Target 3D Point: (${targetPoint.x.toFixed(4)}, ${targetPoint.y.toFixed(4)}, ${targetPoint.z.toFixed(4)})`)

      const direction = targetPoint.clone().normalize()
      console.log(`   Direction (normalized): (${direction.x.toFixed(4)}, ${direction.y.toFixed(4)}, ${direction.z.toFixed(4)})`)

      const finalPosition = direction.multiplyScalar(initialCameraState.distance)
      console.log('   Final Position (Cartesian):')
      console.log(`      x: ${finalPosition.x.toFixed(4)} (East/West)`)
      console.log(`      y: ${finalPosition.y.toFixed(4)} (Up/Down)`)
      console.log(`      z: ${finalPosition.z.toFixed(4)} (North/South)`)

      camera.position.copy(finalPosition)

      // Convert to spherical for verification
      const dist = camera.position.length()
      const camLat = Math.asin(camera.position.y / dist) * (180 / Math.PI)
      const camLon = Math.atan2(-camera.position.z, camera.position.x) * (180 / Math.PI)

      console.log('   Camera Position (Geographic):')
      console.log(`      Latitude:  ${camLat.toFixed(4)}°`)
      console.log(`      Longitude: ${camLon.toFixed(4)}°`)
      console.log(`      Distance:  ${dist.toFixed(4)}`)
    } else {
      // Default camera position scaled to match 1000x Earth radius
      camera.position.set(0, 0, 3000)
      console.log('📍 Using default camera position:')
      console.log('   Cartesian: (0, 0, 3000)')
      console.log('   This is straight out along the Z-axis at distance 3000')
      console.log(`   Distance from origin: ${camera.position.length().toFixed(4)}`)
    }

    console.log('============================================================')

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
    // Earth radius: using 1000.0 as base unit (scaled for Float32 precision)
    const earthRadius = 1000.0
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
    controls.minDistance = 10 // Allow zooming very close to see curtain details (scaled for 1000x Earth radius)
    controls.maxDistance = 10000 // Scaled for 1000x Earth radius
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.5

    // Set initial controls target if provided
    if (initialCameraState) {
      console.log('🎯 ==================== INITIAL CONTROLS TARGET ====================')
      const targetPoint = latLonToPoint3D(initialCameraState.target, 1000.0)
      console.log('   Target (Geographic):')
      console.log(`      Latitude:  ${initialCameraState.target.lat.toFixed(4)}°`)
      console.log(`      Longitude: ${initialCameraState.target.lon.toFixed(4)}°`)
      console.log('   Target (Cartesian):')
      console.log(`      x: ${targetPoint.x.toFixed(4)} (East/West)`)
      console.log(`      y: ${targetPoint.y.toFixed(4)} (Up/Down)`)
      console.log(`      z: ${targetPoint.z.toFixed(4)} (North/South)`)

      controls.target.copy(targetPoint)
      controls.update()

      console.log('')
      console.log('   After controls.update():')
      console.log(`      Controls target: (${controls.target.x.toFixed(4)}, ${controls.target.y.toFixed(4)}, ${controls.target.z.toFixed(4)})`)
      console.log(`      Camera position: (${camera.position.x.toFixed(4)}, ${camera.position.y.toFixed(4)}, ${camera.position.z.toFixed(4)})`)
      console.log(`      Camera distance: ${camera.position.length().toFixed(4)}`)
      console.log('================================================================')
    }

    controlsRef.current = controls

    // Animation loop
    let animationFrameId: number
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      controls.update()

      // Only render if rendering is enabled (not paused for geometry updates)
      if (renderEnabledRef.current) {
        renderer.render(scene, camera)
      }
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

    // Handle click for raycasting, polygon drawing, and ground mode
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouse, camera)

      // Check intersections with globe
      if (globeRef.current) {
        const intersects = raycasterRef.current.intersectObject(globeRef.current)

        if (intersects.length > 0) {
          const point = intersects[0].point
          const latLon = point3DToLatLon(point)

          // Ground mode: place camera marker
          if (isGroundModeActive && onGroundCameraPositionSet) {
            onGroundCameraPositionSet(latLon.lat, latLon.lon)
            return
          }

          // Drawing mode: add vertex to polygon
          if (isDrawingRef.current) {
            setPolygonVertices(prev => {
              // Maximum 4 vertices
              if (prev.length >= 4) {
                console.log('[GlobeViewer] Maximum 4 vertices reached, ignoring click')
                return prev
              }

              const newVertices = [...prev, latLon]
              console.log(`[GlobeViewer] Added vertex ${newVertices.length} at (${latLon.lat.toFixed(4)}, ${latLon.lon.toFixed(4)})`)

              // Auto-complete when 4th vertex is added
              if (newVertices.length === 4) {
                console.log('[GlobeViewer] Auto-completing polygon with 4 vertices')
                setTimeout(() => {
                  setCompletedPolygon(newVertices) // Keep the polygon highlighted
                  onPolygonCompleteRef.current?.(newVertices)
                  setPolygonVertices([])
                  setIsDrawing(false)
                  isDrawingRef.current = false
                }, 100) // Small delay to allow visual feedback
              }

              return newVertices
            })
            return
          }
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

  // Helper to create text sprite for vertex numbers
  const createTextSprite = (text: string, backgroundColor: string, textColor: string): THREE.Sprite => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = 128
    canvas.height = 128

    // Draw background circle
    context.fillStyle = backgroundColor
    context.beginPath()
    context.arc(64, 64, 60, 0, Math.PI * 2)
    context.fill()

    // Draw text
    context.fillStyle = textColor
    context.font = 'bold 80px Arial'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always show on top
      depthWrite: false
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(0.025, 0.025, 1) // 50% smaller for better proportions

    return sprite
  }

  // Visualize polygon (both drawing and completed)
  useEffect(() => {
    if (!sceneRef.current) return

    // Clear existing visualization
    clearPolygonVisualization()

    // Create new polygon group
    const polygonGroup = new THREE.Group()
    polygonGroupRef.current = polygonGroup

    const radius = 1.004 // Slightly above globe surface

    // Visualize completed polygon (if exists)
    if (completedPolygon && completedPolygon.length >= 3) {
      // Draw filled polygon for completed AOI
      const points: THREE.Vector3[] = completedPolygon.map(vertex =>
        latLonToPoint3D(vertex, radius)
      )
      points.push(latLonToPoint3D(completedPolygon[0], radius)) // Close the loop

      // Add polygon outline
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xffff00, // Yellow
        linewidth: 3,
        transparent: true,
        opacity: 1.0
      })
      const line = new THREE.Line(lineGeometry, lineMaterial)
      polygonGroup.add(line)

      // Add numbered vertex markers for completed polygon
      completedPolygon.forEach((vertex, index) => {
        const position = latLonToPoint3D(vertex, radius)

        // Yellow sphere marker (scaled for 1000x Earth radius)
        const sphereGeometry = new THREE.SphereGeometry(10, 16, 16)
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 })
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
        sphere.position.copy(position)
        polygonGroup.add(sphere)

        // Add number sprite - offset outward from globe for visibility
        const numberSprite = createTextSprite((index + 1).toString(), '#ffff00', '#000000')
        const offsetPosition = position.clone().multiplyScalar(1.02) // Move outward from globe
        numberSprite.position.copy(offsetPosition)
        polygonGroup.add(numberSprite)
      })

      console.log(`[GlobeViewer] Visualizing completed polygon with ${completedPolygon.length} vertices`)
    }

    // Visualize drawing vertices (if any)
    if (polygonVertices.length > 0) {
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
          color: 0xffff00, // Yellow during drawing
          linewidth: 2,
          transparent: true,
          opacity: 0.8
        })

        const line = new THREE.Line(geometry, material)
        polygonGroup.add(line)
      }

      // Draw numbered vertex markers
      polygonVertices.forEach((vertex, index) => {
        const position = latLonToPoint3D(vertex, radius)

        // Different color for first vertex (green) vs others (red)
        const color = index === 0 ? 0x00ff00 : 0xff0000
        const bgColor = index === 0 ? '#00ff00' : '#ff0000'
        const sphereGeometry = new THREE.SphereGeometry(10, 16, 16) // Scaled for 1000x Earth radius
        const sphereMaterial = new THREE.MeshBasicMaterial({ color })
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
        sphere.position.copy(position)
        polygonGroup.add(sphere)

        // Add number sprite - offset outward from globe for visibility
        const numberSprite = createTextSprite((index + 1).toString(), bgColor, '#ffffff')
        const offsetPosition = position.clone().multiplyScalar(1.02) // Move outward from globe
        numberSprite.position.copy(offsetPosition)
        polygonGroup.add(numberSprite)
      })

      console.log(`[GlobeViewer] Visualizing ${polygonVertices.length} drawing vertices`)
    }

    if (polygonGroup.children.length > 0) {
      sceneRef.current.add(polygonGroup)
    }

    return () => {
      clearPolygonVisualization()
    }
  }, [polygonVertices, completedPolygon])

  // Load satellite 3D model
  useEffect(() => {
    if (!sceneRef.current) return

    const loader = new GLTFLoader()

    loader.load(
      '/Landsat 1, 2, and 3.glb',
      // onLoad callback
      (gltf) => {
        const satellite = gltf.scene

        // Scale down the satellite (GLB models are often large)
        // Adjust this value based on how the model looks
        satellite.scale.set(0.01, 0.01, 0.01)

        // Position satellite in Low Earth Orbit (LEO)
        // Landsat orbits at ~700km altitude, Earth radius is 1.0 in our units
        // So orbital radius should be approximately 1.11 (1 + 700/6371)
        const orbitalRadius = 1450.0 // Scaled for 1000x Earth radius
        satellite.position.set(orbitalRadius, 0, 0)

        // Add to scene
        sceneRef.current?.add(satellite)
        satelliteRef.current = satellite
      },
      // onProgress callback
      undefined,
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

  // Manage ground camera marker
  useEffect(() => {
    if (groundCameraPositionProp && sceneRef.current) {
      createGroundMarker(groundCameraPositionProp.lat, groundCameraPositionProp.lon)
    } else {
      clearGroundMarker()
    }

    // Cleanup on unmount
    return () => {
      clearGroundMarker()
    }
  }, [groundCameraPositionProp])

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
