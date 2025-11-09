import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, LineLayer, IconLayer, PolygonLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import 'maplibre-gl/dist/maplibre-gl.css'
import './MapBackground.css'
import { PointCloudData } from '../utils/copcLoader'
import { ColorMode, Colormap } from '../App'
import { LatLon } from '../utils/aoiSelector'
import { calculatePointAtDistanceAndBearing, isPointInPolygon, calculateBearing, haversineDistance } from '../utils/coordinateConversion'

interface DeckGLMapViewProps {
  center: [number, number]
  zoom?: number
  data: PointCloudData[]
  colorMode: ColorMode
  colormap: Colormap
  pointSize: number
  dataVersion: number // Increment to trigger layer update when colors change
  isDrawingAOI?: boolean
  aoiPolygon?: LatLon[] | null
  onPolygonComplete?: (polygon: LatLon[]) => void
  onAnimationProgress?: (progress: number) => void
  onCurrentGpsTime?: (gpsTime: number) => void
  onCurrentPosition?: (lat: number, lon: number) => void
  animationProgress?: number // For progressive point rendering during satellite animation
  isGroundModeActive?: boolean
  groundCameraPosition?: { lat: number, lon: number } | null
  onGroundCameraPositionSet?: (lat: number, lon: number) => void
  groundModeViewData?: {
    clickedLat: number
    clickedLon: number
    nearestLat: number
    nearestLon: number
    nearestAlt: number
    distance: number
    bearing: number
    perpendicularBearing: number
  } | null
}

export interface DeckGLMapViewHandle {
  setCenter: (lng: number, lat: number) => void
  setZoom: (zoom: number) => void
  getMap: () => maplibregl.Map | null
  setDrawingMode: (enabled: boolean) => void
  clearPolygon: () => void
  getMapState: () => { center: [number, number], zoom: number } | null
  animateSatellite: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number }, lastPoint: { lon: number, lat: number, alt: number, gpsTime: number }, positions?: Float32Array) => void
}

const DeckGLMapView = forwardRef<DeckGLMapViewHandle, DeckGLMapViewProps>(
  ({ center, zoom = 5, data, colorMode, colormap, pointSize, dataVersion, isDrawingAOI, aoiPolygon, onPolygonComplete, onAnimationProgress, onCurrentGpsTime, onCurrentPosition, animationProgress = 1.0, isGroundModeActive, groundCameraPosition, onGroundCameraPositionSet, groundModeViewData }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const deckOverlayRef = useRef<MapboxOverlay | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [satellitePosition, setSatellitePosition] = useState<[number, number, number] | null>(null)
    const [laserLine, setLaserLine] = useState<[[number, number, number], [number, number, number]] | null>(null)
    const [satelliteIcon, setSatelliteIcon] = useState<string | null>(null)
    const lastCenterPropRef = useRef<[number, number] | null>(null)
    const groundMarkerRef = useRef<maplibregl.Marker | null>(null)

    // Custom polygon drawing state
    const [polygonVertices, setPolygonVertices] = useState<LatLon[]>([])
    const [completedPolygon, setCompletedPolygon] = useState<LatLon[] | null>(null)
    const polygonMarkersRef = useRef<maplibregl.Marker[]>([])
    const polygonLinesRef = useRef<maplibregl.Marker | null>(null)
    const onPolygonCompleteRef = useRef(onPolygonComplete)

    // Ground mode guidance rectangles
    const [groundModeRectangles, setGroundModeRectangles] = useState<Array<{ polygon: Array<{ lat: number, lon: number }> }> | null>(null)
    const [pulseAnimation, setPulseAnimation] = useState(false)

    // Track when ground mode camera has settled at final position (for frustum culling)
    const [groundModeCameraSettled, setGroundModeCameraSettled] = useState(false)

    // Refs for ground mode to avoid stale closures in click handler
    const isGroundModeActiveRef = useRef(isGroundModeActive)
    const isDrawingAOIRef = useRef(isDrawingAOI)
    const onGroundCameraPositionSetRef = useRef(onGroundCameraPositionSet)
    const groundModeRectanglesRef = useRef(groundModeRectangles)

    // Store camera state before ground mode for restoration
    const preGroundModeCameraRef = useRef<{
      center: [number, number]
      zoom: number
      bearing: number
      pitch: number
    } | null>(null)

    // Store ground mode zoom listener cleanup function
    const groundModeZoomCleanupRef = useRef<(() => void) | null>(null)

    // Keep refs in sync with props - UPDATE DURING RENDER, not in an effect
    // This ensures the refs are updated BEFORE effects run, preventing race conditions
    isGroundModeActiveRef.current = isGroundModeActive
    isDrawingAOIRef.current = isDrawingAOI
    onGroundCameraPositionSetRef.current = onGroundCameraPositionSet
    onPolygonCompleteRef.current = onPolygonComplete
    groundModeRectanglesRef.current = groundModeRectangles

    // Clear polygon visualization markers and lines
    const clearPolygonVisualization = () => {
      // Remove markers
      polygonMarkersRef.current.forEach(marker => marker.remove())
      polygonMarkersRef.current = []

      // Remove line overlay if exists
      if (polygonLinesRef.current) {
        polygonLinesRef.current.remove()
        polygonLinesRef.current = null
      }
    }

    // Calculate ground mode guidance rectangles
    const calculateGroundModeRectangles = (): Array<{ polygon: Array<{ lat: number, lon: number }> }> | null => {
      if (data.length === 0) return null

      // Find overall bounds across all datasets
      let minLat = Infinity, maxLat = -Infinity
      let minLon = Infinity, maxLon = -Infinity
      let firstPoint: { lat: number, lon: number } | null = null
      let lastPoint: { lat: number, lon: number } | null = null

      data.forEach(dataset => {
        // Use bounds from dataset
        if (dataset.bounds) {
          minLon = Math.min(minLon, dataset.bounds.min[0])
          minLat = Math.min(minLat, dataset.bounds.min[1])
          maxLon = Math.max(maxLon, dataset.bounds.max[0])
          maxLat = Math.max(maxLat, dataset.bounds.max[1])
        }

        // Get first and last points for track direction
        if (dataset.firstPoint && !firstPoint) {
          firstPoint = { lat: dataset.firstPoint.lat, lon: dataset.firstPoint.lon }
        }
        if (dataset.lastPoint) {
          lastPoint = { lat: dataset.lastPoint.lat, lon: dataset.lastPoint.lon }
        }
      })

      if (!firstPoint || !lastPoint) {
        console.warn('[DeckGLMapView] Missing first/last points for ground mode rectangles')
        return null
      }

      // Type assertion to help TypeScript understand these are no longer null
      const first: { lat: number, lon: number } = firstPoint
      const last: { lat: number, lon: number } = lastPoint

      // Calculate track length to determine number of sample points
      const trackLength = haversineDistance(first.lat, first.lon, last.lat, last.lon)

      // Helper function to calculate latitude-adjusted offset distances
      // Shrinks rectangle width at high northern latitudes (>55°N) to account for meridian convergence
      const getLatitudeAdjustedOffsets = (lat: number): { inner: number, outer: number } => {
        const absLat = Math.abs(lat)

        // Base offsets for latitudes below 55°
        const baseInner = 150  // km
        const baseOuter = 200  // km

        if (absLat < 55) {
          // Below 55°, use full width
          return { inner: baseInner, outer: baseOuter }
        }

        // Above 55°, scale down based on cosine of latitude (meridian convergence)
        // At 55°: scale = cos(55°) ≈ 0.57 (43% reduction)
        // At 70°: scale = cos(70°) ≈ 0.34 (66% reduction)
        // At 85°: scale = cos(85°) ≈ 0.09 (91% reduction)
        const latRad = absLat * (Math.PI / 180)
        const scaleFactor = Math.cos(latRad)

        return {
          inner: baseInner * scaleFactor,
          outer: baseOuter * scaleFactor
        }
      }

      // Sample every ~50km along the track for smooth curves
      const numSamples = Math.max(4, Math.ceil(trackLength / 50))

      // Helper function to calculate track direction from a window of points
      // Uses 5 points centered on the middle point to determine local track bearing
      const calculateLocalTrackBearing = (trackPoints: Array<{ lat: number, lon: number }>, centerIndex: number): number | null => {
        const windowSize = 5
        const halfWindow = Math.floor(windowSize / 2)

        const startIdx = Math.max(0, centerIndex - halfWindow)
        const endIdx = Math.min(trackPoints.length - 1, centerIndex + halfWindow)

        // Need at least 2 points to calculate bearing
        if (endIdx <= startIdx) return null

        // Calculate average bearing across the window
        // This smooths out noise and handles curves better
        const startPoint = trackPoints[startIdx]
        const endPoint = trackPoints[endIdx]

        return calculateBearing(startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon)
      }

      // Helper function to create rectangle segments at a given offset
      // Creates multiple small 4-point rectangles instead of one large polygon
      // Each rectangle connects two consecutive sample points
      const createRectangle = (isLeftSide: boolean): Array<{ polygon: Array<{ lat: number, lon: number }> }> => {
        // Collect all actual positions from the data to sample the real track
        // IMPORTANT: Deduplicate to get unique x,y positions since COPC data is grouped
        const seenPositions = new Set<string>()
        const actualTrackPoints: Array<{ lat: number, lon: number }> = []

        data.forEach(dataset => {
          if (dataset.positions) {
            for (let i = 0; i < dataset.positions.length; i += 3) {
              const lon = dataset.positions[i]
              const lat = dataset.positions[i + 1]

              // Create a unique key for this position (round to avoid floating point issues)
              const key = `${lat.toFixed(6)},${lon.toFixed(6)}`

              if (!seenPositions.has(key)) {
                seenPositions.add(key)
                actualTrackPoints.push({ lon, lat })
              }
            }
          }
        })

        if (actualTrackPoints.length < 5) {
          console.warn(`[DeckGLMapView] Not enough track points (need at least 5, have ${actualTrackPoints.length})`)
          return []
        }

        // Sample points from the actual track at regular intervals
        // Calculate sample indices to get approximately numSamples points
        const sampleIndices: number[] = []
        for (let i = 0; i < numSamples; i++) {
          const fraction = i / (numSamples - 1)
          const index = Math.min(
            Math.floor(fraction * (actualTrackPoints.length - 1)),
            actualTrackPoints.length - 1
          )
          sampleIndices.push(index)
        }

        // First pass: Calculate all local bearings
        const localBearings: Array<{ index: number, bearing: number }> = []
        for (const sampleIdx of sampleIndices) {
          const localTrackBearing = calculateLocalTrackBearing(actualTrackPoints, sampleIdx)
          if (localTrackBearing !== null) {
            localBearings.push({ index: sampleIdx, bearing: localTrackBearing })
          }
        }

        if (localBearings.length === 0) {
          console.warn(`[DeckGLMapView] No valid bearings calculated`)
          return []
        }

        // Second pass: Smooth the bearings using a moving average
        const smoothedBearings: number[] = []
        const smoothingWindow = 3 // Use 3 bearings for smoothing

        for (let i = 0; i < localBearings.length; i++) {
          const start = Math.max(0, i - Math.floor(smoothingWindow / 2))
          const end = Math.min(localBearings.length, i + Math.ceil(smoothingWindow / 2))

          let sumSin = 0
          let sumCos = 0
          for (let j = start; j < end; j++) {
            const bearingRad = localBearings[j].bearing * Math.PI / 180
            sumSin += Math.sin(bearingRad)
            sumCos += Math.cos(bearingRad)
          }

          // Calculate average bearing using vector averaging
          const avgBearing = Math.atan2(sumSin, sumCos) * 180 / Math.PI
          smoothedBearings.push((avgBearing + 360) % 360)
        }

        // Helper to detect if a line segment crosses the dateline
        const crossesDateline = (lon1: number, lon2: number): boolean => {
          return Math.abs(lon2 - lon1) > 180
        }

        // Third pass: Create small rectangular segments
        // Each segment connects two consecutive sample points
        const rectangleSegments: Array<{ polygon: Array<{ lat: number, lon: number }> }> = []
        let skippedCount = 0

        for (let i = 0; i < localBearings.length - 1; i++) {
          const idx1 = localBearings[i].index
          const idx2 = localBearings[i + 1].index
          const centerPoint1 = actualTrackPoints[idx1]
          const centerPoint2 = actualTrackPoints[idx2]
          const smoothedBearing1 = smoothedBearings[i]
          const smoothedBearing2 = smoothedBearings[i + 1]

          // Calculate latitude-adjusted offsets for each point
          const offsets1 = getLatitudeAdjustedOffsets(centerPoint1.lat)
          const offsets2 = getLatitudeAdjustedOffsets(centerPoint2.lat)

          // Calculate perpendicular bearings for both points
          const perpendicularBearing1 = isLeftSide
            ? (smoothedBearing1 - 90 + 360) % 360  // 90° left
            : (smoothedBearing1 + 90) % 360         // 90° right

          const perpendicularBearing2 = isLeftSide
            ? (smoothedBearing2 - 90 + 360) % 360
            : (smoothedBearing2 + 90) % 360

          // Calculate inner and outer points for both positions using latitude-adjusted offsets
          const inner1 = calculatePointAtDistanceAndBearing(
            centerPoint1.lat, centerPoint1.lon, offsets1.inner, perpendicularBearing1
          )
          const outer1 = calculatePointAtDistanceAndBearing(
            centerPoint1.lat, centerPoint1.lon, offsets1.outer, perpendicularBearing1
          )
          const inner2 = calculatePointAtDistanceAndBearing(
            centerPoint2.lat, centerPoint2.lon, offsets2.inner, perpendicularBearing2
          )
          const outer2 = calculatePointAtDistanceAndBearing(
            centerPoint2.lat, centerPoint2.lon, offsets2.outer, perpendicularBearing2
          )

          // Check if any edge of this rectangle crosses the dateline
          const crosses = crossesDateline(inner1.lon, inner2.lon) ||
                         crossesDateline(outer1.lon, outer2.lon) ||
                         crossesDateline(inner1.lon, outer1.lon) ||
                         crossesDateline(inner2.lon, outer2.lon)

          if (crosses) {
            skippedCount++
            continue  // Skip rectangles that cross the dateline
          }

          // Create a 4-point rectangle polygon in counter-clockwise order
          // Order: inner1 -> inner2 -> outer2 -> outer1 -> back to inner1
          const rectangle = {
            polygon: [inner1, inner2, outer2, outer1]
          }

          rectangleSegments.push(rectangle)
        }

        return rectangleSegments
      }

      // Create left and right rectangle segments using actual track data
      const leftRectangles = createRectangle(true)  // Left side (90° left of track)
      const rightRectangles = createRectangle(false) // Right side (90° right of track)

      // Combine left and right rectangles into one array
      const allRectangles = [...leftRectangles, ...rightRectangles]

      console.log(`[DeckGLMapView] Ground mode: Created ${allRectangles.length} rectangle segments (${leftRectangles.length} left, ${rightRectangles.length} right)`)

      return allRectangles
    }

    useImperativeHandle(ref, () => ({
      setCenter: (lng: number, lat: number) => {
        if (mapRef.current) {
          mapRef.current.setCenter([lng, lat])
        }
      },
      setZoom: (zoom: number) => {
        if (mapRef.current) {
          mapRef.current.setZoom(zoom)
        }
      },
      getMap: () => mapRef.current,
      setDrawingMode: (enabled: boolean) => {
        setIsDrawing(enabled)
        console.log(`[DeckGLMapView] Setting drawing mode: ${enabled}`)

        if (!enabled) {
          // User clicked "Finish AOI" - complete the polygon if we have at least 3 vertices
          if (polygonVertices.length >= 3) {
            console.log(`[DeckGLMapView] Completing polygon with ${polygonVertices.length} vertices`)
            setCompletedPolygon(polygonVertices) // Keep the polygon highlighted
            onPolygonCompleteRef.current?.(polygonVertices)
            setPolygonVertices([]) // Clear drawing vertices but keep completed polygon
          } else if (polygonVertices.length > 0) {
            console.log(`[DeckGLMapView] Not enough vertices (${polygonVertices.length}), need at least 3`)
          }
        } else {
          // Starting new drawing - clear any existing vertices and completed polygon
          setPolygonVertices([])
          setCompletedPolygon(null)
          clearPolygonVisualization()
        }
      },
      clearPolygon: () => {
        console.log('[DeckGLMapView] Clearing polygon')
        setPolygonVertices([])
        setCompletedPolygon(null)
        clearPolygonVisualization()
      },
      getMapState: () => {
        if (!mapRef.current) return null

        const center = mapRef.current.getCenter()
        const zoom = mapRef.current.getZoom()

        return {
          center: [center.lng, center.lat],
          zoom
        }
      },
      animateSatellite: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number }, lastPoint: { lon: number, lat: number, alt: number, gpsTime: number }, positions?: Float32Array) => {
        // Cancel any existing animation
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }

        // Reset animation progress to 0
        onAnimationProgress?.(0)

        // Set initial satellite position (elevated above ground for visibility)
        const satelliteAltitude = 100000 // 100km above ground for visibility in 2D
        setSatellitePosition([firstPoint.lon, firstPoint.lat, satelliteAltitude])
        setLaserLine([[firstPoint.lon, firstPoint.lat, satelliteAltitude], [firstPoint.lon, firstPoint.lat, 0]])

        const startTime = Date.now()
        const duration = 5000 // 5 seconds animation

        // Animation loop
        const animate = () => {
          const elapsed = Date.now() - startTime
          const progress = Math.min(elapsed / duration, 1.0)
          const eased = progress

          let currentLat, currentLon, currentGpsTime

          if (positions) {
            // Use actual point data
            const totalPoints = positions.length / 3
            const currentPointIndex = Math.floor(totalPoints * eased)
            const clampedIndex = Math.min(currentPointIndex, totalPoints - 1)

            currentLon = positions[clampedIndex * 3]
            currentLat = positions[clampedIndex * 3 + 1]
            currentGpsTime = firstPoint.gpsTime + (lastPoint.gpsTime - firstPoint.gpsTime) * eased
          } else {
            // Fallback to simple linear interpolation
            currentLat = firstPoint.lat + (lastPoint.lat - firstPoint.lat) * eased
            currentLon = firstPoint.lon + (lastPoint.lon - firstPoint.lon) * eased
            currentGpsTime = firstPoint.gpsTime + (lastPoint.gpsTime - firstPoint.gpsTime) * eased
          }

          // Update satellite position and laser line (line from satellite to ground)
          const satelliteAltitude = 100000 // 100km above ground
          setSatellitePosition([currentLon, currentLat, satelliteAltitude])
          setLaserLine([[currentLon, currentLat, satelliteAltitude], [currentLon, currentLat, 0]])

          // Notify parent of progress, GPS time, and current position
          onAnimationProgress?.(progress)
          onCurrentGpsTime?.(currentGpsTime)
          onCurrentPosition?.(currentLat, currentLon)

          if (progress < 1.0) {
            animationFrameRef.current = requestAnimationFrame(animate)
          } else {
            animationFrameRef.current = null
            onAnimationProgress?.(1.0)
            // Clear satellite and line after animation completes
            setSatellitePosition(null)
            setLaserLine(null)
          }
        }

        animate()
      }
    }))

    // Load satellite 3D model and create sprite
    useEffect(() => {
      const loader = new GLTFLoader()
      loader.load(
        '/Landsat 1, 2, and 3.glb',
        (gltf) => {
          // Create a scene to render the satellite model as an image
          const scene = new THREE.Scene()
          scene.background = new THREE.Color(0x000000) // Transparent background won't work, use black

          const satellite = gltf.scene
          satellite.scale.set(1, 1, 1)
          scene.add(satellite)

          // Add lighting
          const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
          scene.add(ambientLight)
          const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
          directionalLight.position.set(5, 5, 5)
          scene.add(directionalLight)

          // Create camera
          const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
          camera.position.set(3, 2, 3)
          camera.lookAt(0, 0, 0)

          // Create renderer
          const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
          renderer.setSize(128, 128)

          // Render to canvas
          renderer.render(scene, camera)

          // Convert canvas to data URL
          const iconDataUrl = renderer.domElement.toDataURL('image/png')
          setSatelliteIcon(iconDataUrl)

          // Cleanup
          renderer.dispose()
        },
        undefined,
        (error) => {
          console.error('Error loading satellite model for 2D view:', error)
        }
      )
    }, [])

    // Initialize map
    useEffect(() => {
      if (!mapContainer.current) return

      console.log(`[DeckGLMapView] ===== MAP INITIALIZATION START =====`)
      console.log(`[DeckGLMapView] Received props: center = (${center[0].toFixed(4)}, ${center[1].toFixed(4)}), zoom = ${zoom.toFixed(4)}`)
      console.log(`[DeckGLMapView] Initializing map with center (${center[0].toFixed(2)}, ${center[1].toFixed(2)}), zoom ${zoom}`)

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            'osm': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          },
          layers: [
            {
              id: 'osm',
              type: 'raster',
              source: 'osm',
              minzoom: 0,
              maxzoom: 19
            }
          ]
        },
        center: center,
        zoom: zoom,
        pitch: 60,
        bearing: 0,
        antialias: true,
        maxPitch: 85
        // renderWorldCopies defaults to true, allowing map to repeat
      })

      console.log(`[DeckGLMapView] Map initialized, actual center: (${map.getCenter().lng.toFixed(2)}, ${map.getCenter().lat.toFixed(2)}), zoom: ${map.getZoom().toFixed(1)}`)

      // Add navigation controls
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
      map.addControl(new maplibregl.ScaleControl(), 'bottom-left')

      mapRef.current = map

      // Initialize deck.gl overlay
      const deckOverlay = new MapboxOverlay({
        interleaved: true,
        layers: []
      })

      map.addControl(deckOverlay as any)
      deckOverlayRef.current = deckOverlay

      // Custom click-based polygon drawing (3-4 vertex constraint)
      // Handle clicks for both polygon drawing and ground mode
      const handleMapClick = (e: maplibregl.MapMouseEvent) => {
        const { lng, lat } = e.lngLat

        // Handle polygon drawing mode
        if (isDrawingAOIRef.current) {
          setPolygonVertices(prev => {
            // Maximum 4 vertices
            if (prev.length >= 4) {
              console.log('[DeckGLMapView] Maximum 4 vertices reached, ignoring click')
              return prev
            }

            const newVertices = [...prev, { lat, lon: lng }]
            console.log(`[DeckGLMapView] Added vertex ${newVertices.length} at (${lat.toFixed(4)}, ${lng.toFixed(4)})`)

            // Auto-complete when 4th vertex is added
            if (newVertices.length === 4) {
              console.log('[DeckGLMapView] Auto-completing polygon with 4 vertices')
              setTimeout(() => {
                setCompletedPolygon(newVertices) // Keep the polygon highlighted
                onPolygonCompleteRef.current?.(newVertices)
                setPolygonVertices([])
                setIsDrawing(false)
              }, 100) // Small delay to allow visual feedback
            }

            return newVertices
          })
          return
        }

        // Handle ground mode clicks (only when not drawing AOI)
        if (isGroundModeActiveRef.current && onGroundCameraPositionSetRef.current) {
          console.log(`[DeckGLMapView] Ground mode click detected at (${lat.toFixed(4)}, ${lng.toFixed(4)})`)

          // Validate click is within one of the ground mode rectangles
          const clickPoint = { lat, lon: lng }
          let isValidClick = false

          if (groundModeRectanglesRef.current && groundModeRectanglesRef.current.length > 0) {
            // Check if click is inside ANY of the guidance rectangle polygons
            for (const rect of groundModeRectanglesRef.current) {
              if (isPointInPolygon(clickPoint, rect.polygon)) {
                isValidClick = true
                console.log(`[DeckGLMapView] ✓ Click is inside guidance rectangle at (${lat.toFixed(4)}, ${lng.toFixed(4)})`)
                break
              }
            }

            if (!isValidClick) {
              console.log(`[DeckGLMapView] ✗ Click at (${lat.toFixed(4)}, ${lng.toFixed(4)}) is outside all ${groundModeRectanglesRef.current.length} guidance rectangles`)
            }
          } else {
            // If rectangles haven't been calculated yet, allow the click
            console.log(`[DeckGLMapView] No rectangles calculated yet, allowing click`)
            isValidClick = true
          }

          if (isValidClick) {
            console.log(`[DeckGLMapView] ✓ Valid ground mode click within guidance rectangles - placing marker`)
            onGroundCameraPositionSetRef.current(lat, lng)
          } else {
            console.log(`[DeckGLMapView] ✗ Invalid ground mode click outside guidance rectangles - triggering pulse`)
            // Trigger pulse animation
            setPulseAnimation(true)
            setTimeout(() => setPulseAnimation(false), 500) // Reset after 500ms
          }
        }
      }
      map.on('click', handleMapClick)

      return () => {
        map.off('click', handleMapClick)
        map.remove()
      }
    }, [])

    // Update center and zoom when props change
    useEffect(() => {
      console.log(`[DeckGLMapView] Center/zoom effect triggered: hasMap=${!!mapRef.current}, isGroundModeActive=${isGroundModeActiveRef.current}, center=(${center[0].toFixed(4)}, ${center[1].toFixed(4)}), zoom=${zoom}`)

      if (!mapRef.current) return

      // Skip updates when ground mode is active and has view data
      // The flyTo animation will handle the camera movement
      if (isGroundModeActiveRef.current && groundModeViewData) {
        console.log(`[DeckGLMapView] ⏭️  Skipping center/zoom update - ground mode flyTo will handle camera positioning`)
        // Still update the ref to track the prop change
        lastCenterPropRef.current = [center[0], center[1]]
        return
      }

      // Check if the prop actually changed from its previous value
      const threshold = 0.0001 // ~10 meters tolerance
      const centerChanged = !lastCenterPropRef.current ||
                         Math.abs(lastCenterPropRef.current[0] - center[0]) > threshold ||
                         Math.abs(lastCenterPropRef.current[1] - center[1]) > threshold

      if (!centerChanged) {
        // Prop didn't change, don't update the map
        console.log(`[DeckGLMapView] Center/zoom props unchanged, skipping update`)
        return
      }

      console.log(`[DeckGLMapView] Center prop changed from (${lastCenterPropRef.current?.[0].toFixed(4) ?? 'null'}, ${lastCenterPropRef.current?.[1].toFixed(4) ?? 'null'}) to (${center[0].toFixed(4)}, ${center[1].toFixed(4)}), zoom=${zoom}`)

      const updateCenterAndZoom = () => {
        if (mapRef.current) {
          console.log(`[DeckGLMapView] ✅ Applying center and zoom update to map`)
          mapRef.current.setCenter([center[0], center[1]])
          mapRef.current.setZoom(zoom)
          lastCenterPropRef.current = [center[0], center[1]]
        }
      }

      if (mapRef.current.loaded()) {
        updateCenterAndZoom()
      } else {
        mapRef.current.once('load', updateCenterAndZoom)
      }
    }, [center, zoom, groundModeViewData])

    // Handle drawing mode changes (now handled by custom click system)
    // Old MapboxDraw mode switching is no longer needed
    useEffect(() => {
      setIsDrawing(isDrawingAOI ?? false)
    }, [isDrawingAOI])

    // Clear polygon when aoiPolygon is null
    useEffect(() => {
      if (aoiPolygon === null) {
        setPolygonVertices([])
        setCompletedPolygon(null)
        clearPolygonVisualization()
      }
    }, [aoiPolygon])

    // Track zoom level for LOD
    const [currentZoom, setCurrentZoom] = useState<number>(zoom)

    // Update zoom tracking when map zoom changes
    useEffect(() => {
      if (!mapRef.current) return

      const handleZoom = () => {
        if (mapRef.current) {
          setCurrentZoom(mapRef.current.getZoom())
        }
      }

      mapRef.current.on('zoom', handleZoom)
      return () => {
        mapRef.current?.off('zoom', handleZoom)
      }
    }, [])

    // Get subsample rate based on zoom level - minimum 50% of points at all zooms
    const getSubsampleRate = (zoom: number, groundModeActive: boolean): number => {
      // Always show all points in ground mode for maximum detail
      if (groundModeActive) return 1

      // Show at least 50% of points at all zoom levels (subsample rate = 2 maximum)
      // This ensures large datasets are still visible even when zoomed out
      if (zoom < 9) return 2         // 50% of points (~2.2M points for large files)
      return 1                        // All points at zoom 9+
    }

    // Update deck.gl layers when data or settings change
    useEffect(() => {
      if (!deckOverlayRef.current || data.length === 0) return

      // Get subsample rate based on current zoom level and ground mode
      const subsampleRate = getSubsampleRate(currentZoom, isGroundModeActiveRef.current)
      const useAveraging = isGroundModeActiveRef.current ? false : currentZoom < 9 // No averaging in ground mode
      const neighborCount = 40 // Number of neighbors to average

      // FRUSTUM CULLING DISABLED FOR GROUND MODE
      // Geographic bounds-based culling doesn't work for ground mode because:
      // 1. You're looking UP at satellite data from the ground
      // 2. Visible data can be very far away geographically but still in view due to altitude
      // 3. Even with 100x extension factors, too much visible data gets culled out
      // Performance is acceptable rendering all 4.38M points without culling
      let visibleBounds: { minLat: number, maxLat: number, minLon: number, maxLon: number } | null = null

      const groundModeInfo = isGroundModeActiveRef.current
        ? (groundModeCameraSettled ? ' (Ground Mode: all points)' : ' (Ground Mode: waiting for camera...)')
        : ''
      console.log(`[DeckGLMapView] Zoom ${currentZoom.toFixed(1)}, subsample rate: 1:${subsampleRate}, averaging: ${useAveraging}${groundModeInfo}`)

      const points: Array<{ position: [number, number, number], color: [number, number, number] }> = []

      data.forEach((dataset, datasetIndex) => {
        if (useAveraging) {
          // Regional max approach: group nearby points and take maximum values
          const totalPoints = dataset.positions.length / 3
          const numRegions = Math.floor(totalPoints / subsampleRate)

          for (let regionIdx = 0; regionIdx < numRegions; regionIdx++) {
            // Calculate the center point index for this region
            const centerIdx = regionIdx * subsampleRate

            // Collect up to neighborCount points around the center
            const startIdx = Math.max(0, centerIdx - Math.floor(neighborCount / 2))
            const endIdx = Math.min(totalPoints, startIdx + neighborCount)
            const actualCount = endIdx - startIdx

            // Find maximum values for position and colors
            let avgLon = 0, avgLat = 0 // Average position for spatial accuracy
            let maxAlt = -Infinity
            let maxR = 0, maxG = 0, maxB = 0

            for (let idx = startIdx; idx < endIdx; idx++) {
              const posIdx = idx * 3

              // Average the geographic position for accuracy
              avgLon += dataset.positions[posIdx]
              avgLat += dataset.positions[posIdx + 1]

              // Take max altitude
              maxAlt = Math.max(maxAlt, dataset.positions[posIdx + 2])

              // Take max color values (highlights high intensity features)
              maxR = Math.max(maxR, dataset.colors[posIdx])
              maxG = Math.max(maxG, dataset.colors[posIdx + 1])
              maxB = Math.max(maxB, dataset.colors[posIdx + 2])
            }

            // Calculate average position but use max altitude and colors
            avgLon /= actualCount
            avgLat /= actualCount

            points.push({
              position: [avgLon, avgLat, maxAlt * 1000], // Convert km to meters, use max altitude
              color: [maxR, maxG, maxB] // Use max color values
            })
          }
        } else {
          // Simple decimation for close zoom levels
          for (let i = 0; i < dataset.positions.length; i += 3) {
            if ((i / 3) % subsampleRate !== 0) continue

            const lon = dataset.positions[i]
            const lat = dataset.positions[i + 1]
            const alt = dataset.positions[i + 2] * 1000 // Convert km to meters

            // Apply frustum culling in ground mode
            if (visibleBounds) {
              // Skip points outside visible bounds
              if (lat < visibleBounds.minLat || lat > visibleBounds.maxLat ||
                  lon < visibleBounds.minLon || lon > visibleBounds.maxLon) {
                continue
              }
            }

            const colorIndex = i // colors array has same indexing as positions
            const r = dataset.colors[colorIndex]
            const g = dataset.colors[colorIndex + 1]
            const b = dataset.colors[colorIndex + 2]

            points.push({
              position: [lon, lat, alt],
              color: [r, g, b]
            })
          }
        }
      })

      // Apply animation progress to show only a subset of points (curtain effect)
      const visiblePointCount = Math.floor(points.length * animationProgress)
      const visiblePoints = points.slice(0, visiblePointCount)

      // Calculate total points in dataset for culling stats
      const totalDatasetPoints = data.reduce((sum, dataset) => sum + dataset.positions.length / 3, 0)
      const cullingInfo = visibleBounds
        ? ` (frustum culled ${totalDatasetPoints.toLocaleString()} → ${points.length.toLocaleString()} points, ${((points.length / totalDatasetPoints) * 100).toFixed(1)}% visible)`
        : ''

      // Additional logging for large datasets
      if (totalDatasetPoints > 100000) {
        console.log(`[DeckGLMapView] 📊 LARGE DATASET: ${totalDatasetPoints.toLocaleString()} total points`)
        console.log(`[DeckGLMapView]   Subsample rate: 1:${subsampleRate}`)
        console.log(`[DeckGLMapView]   Ground mode active: ${isGroundModeActiveRef.current}`)
        console.log(`[DeckGLMapView]   Frustum culling: ${isGroundModeActiveRef.current ? 'DISABLED (ground mode)' : 'not applicable'}`)
        console.log(`[DeckGLMapView]   Points rendered: ${points.length.toLocaleString()}`)
      }

      console.log('[DeckGLMapView] Creating layer with', visiblePoints.length, '/', points.length, `points (${(animationProgress * 100).toFixed(1)}% progress)${cullingInfo}`)
      console.log('[DeckGLMapView] Sample colors:', points.slice(0, 5).map(p => p.color))
      console.log('[DeckGLMapView] ColorMode:', colorMode, 'Colormap:', colormap, 'DataVersion:', dataVersion)

      // Create scatterplot layer with round, billboard-facing points
      const pointCloudLayer = new ScatterplotLayer({
        id: 'point-cloud',
        data: visiblePoints,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        radiusMinPixels: 2, // Minimum pixel size
        radiusMaxPixels: 8, // Maximum pixel size
        getRadius: pointSize, // Use pointSize directly
        radiusUnits: 'pixels', // Use pixels for consistent round appearance
        opacity: 0.9,
        pickable: false,
        billboard: true, // Points always face camera for round appearance
        antialiasing: true // Smooth edges for rounder appearance
      })

      const layers: any[] = [pointCloudLayer]

      // Add completed polygon (highlighted region that persists until cleared)
      if (completedPolygon && completedPolygon.length >= 3) {
        // Convert LatLon[] to GeoJSON-style coordinates
        const polygonCoords = completedPolygon.map(v => [v.lon, v.lat])

        // Add filled polygon layer
        const completedPolygonLayer = new PolygonLayer({
          id: 'completed-polygon-fill',
          data: [{ polygon: polygonCoords }],
          getPolygon: (d: any) => d.polygon,
          getFillColor: [255, 255, 0, 80], // Yellow with transparency
          getLineColor: [255, 255, 0, 255], // Solid yellow border
          getLineWidth: 3,
          lineWidthUnits: 'pixels',
          filled: true,
          stroked: true,
          pickable: false
        })
        layers.push(completedPolygonLayer)

        console.log(`[DeckGLMapView] Rendering completed polygon with ${completedPolygon.length} vertices`)
      }

      // Add ground mode guidance rectangles (grey semi-transparent)
      // Use a SINGLE PolygonLayer for all rectangles for better performance
      if (groundModeRectangles && groundModeRectangles.length > 0) {
        // Calculate opacity based on pulse animation
        const baseFillOpacity = 100
        const baseStrokeOpacity = 200
        const fillOpacity = pulseAnimation ? baseFillOpacity + 80 : baseFillOpacity  // Brighter when pulsing
        const strokeOpacity = pulseAnimation ? 255 : baseStrokeOpacity

        // Convert all rectangle polygons to coordinate arrays
        const polygonData = groundModeRectangles.map(rect => ({
          polygon: rect.polygon.map(v => [v.lon, v.lat])
        }))

        const rectanglesLayer = new PolygonLayer({
          id: 'ground-mode-rectangles',
          data: polygonData,
          getPolygon: (d: any) => d.polygon,
          getFillColor: [128, 128, 128, fillOpacity], // Grey with transparency, brighter when pulsing
          getLineColor: [80, 80, 80, strokeOpacity], // Darker grey border
          getLineWidth: pulseAnimation ? 5 : 3, // Thicker when pulsing
          lineWidthUnits: 'pixels',
          filled: true,
          stroked: true,
          pickable: true,  // Enable clicks within rectangles
          transitions: {
            getFillColor: { duration: 300, easing: (t: number) => t },
            getLineWidth: { duration: 300, easing: (t: number) => t },
            getLineColor: { duration: 300, easing: (t: number) => t }
          }
        })
        layers.push(rectanglesLayer)

        console.log(`[DeckGLMapView] Rendering ${groundModeRectangles.length} ground mode guidance rectangles in single layer (pulse: ${pulseAnimation})`)
      }

      // Add polygon lines if drawing vertices exist
      if (polygonVertices.length >= 2) {
        const lineSegments: Array<{ source: [number, number], target: [number, number] }> = []

        // Connect consecutive vertices
        for (let i = 0; i < polygonVertices.length - 1; i++) {
          lineSegments.push({
            source: [polygonVertices[i].lon, polygonVertices[i].lat],
            target: [polygonVertices[i + 1].lon, polygonVertices[i + 1].lat]
          })
        }

        // Close the polygon if we have 3+ vertices
        if (polygonVertices.length >= 3) {
          lineSegments.push({
            source: [polygonVertices[polygonVertices.length - 1].lon, polygonVertices[polygonVertices.length - 1].lat],
            target: [polygonVertices[0].lon, polygonVertices[0].lat]
          })
        }

        const polygonLineLayer = new LineLayer({
          id: 'polygon-lines',
          data: lineSegments,
          getSourcePosition: (d: any) => d.source,
          getTargetPosition: (d: any) => d.target,
          getColor: [255, 255, 0], // Yellow color for polygon
          getWidth: 3,
          widthUnits: 'pixels'
        })
        layers.push(polygonLineLayer)
      }

      // Add laser line layer if animating
      if (laserLine) {
        const laserLayer = new LineLayer({
          id: 'laser-line',
          data: [{ source: laserLine[0], target: laserLine[1] }],
          getSourcePosition: (d: any) => d.source,
          getTargetPosition: (d: any) => d.target,
          getColor: [0, 255, 0], // Green color
          getWidth: 3,
          widthUnits: 'pixels'
        })
        layers.push(laserLayer)
      }

      // Add satellite icon layer if animating
      if (satellitePosition && satelliteIcon) {
        const satelliteLayer = new IconLayer({
          id: 'satellite-icon',
          data: [{ position: satellitePosition }],
          getPosition: (d: any) => d.position,
          getIcon: () => ({
            url: satelliteIcon,
            width: 128,
            height: 128,
            anchorY: 64
          }),
          getSize: 48,
          sizeUnits: 'pixels',
          pickable: false
        })
        layers.push(satelliteLayer)
      } else if (satellitePosition) {
        // Fallback to circle if icon not loaded yet
        const satelliteLayer = new ScatterplotLayer({
          id: 'satellite-model',
          data: [{ position: satellitePosition }],
          getPosition: (d: any) => d.position,
          getFillColor: [255, 215, 0], // Gold color for satellite
          getRadius: 20,
          radiusUnits: 'pixels',
          opacity: 1.0,
          pickable: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 3,
          getLineColor: [255, 255, 255] // White outline
        })
        layers.push(satelliteLayer)
      }

      deckOverlayRef.current.setProps({ layers })
    }, [data, colorMode, colormap, pointSize, dataVersion, currentZoom, animationProgress, laserLine, satellitePosition, satelliteIcon, polygonVertices, completedPolygon, groundModeRectangles, pulseAnimation, isGroundModeActive, groundModeCameraSettled])

    // Ground mode camera transition - create first-person ground view
    useEffect(() => {
      console.log(`[DeckGLMapView] Ground mode camera effect triggered:`, {
        hasMap: !!mapRef.current,
        hasViewData: !!groundModeViewData,
        viewData: groundModeViewData
      })

      if (!mapRef.current || !groundModeViewData) {
        console.log(`[DeckGLMapView] Skipping ground mode transition - missing map or view data`)
        return
      }

      console.log(`[DeckGLMapView] ✅ Ground mode transition STARTING: bearing=${groundModeViewData.perpendicularBearing.toFixed(1)}°, distance=${groundModeViewData.distance.toFixed(2)}km`)

      // Mark camera as not settled while transition is starting
      setGroundModeCameraSettled(false)

      // Store current camera state ONLY on first ground mode activation (not on subsequent position changes)
      if (!preGroundModeCameraRef.current) {
        const currentCenter = mapRef.current.getCenter()
        preGroundModeCameraRef.current = {
          center: [currentCenter.lng, currentCenter.lat],
          zoom: mapRef.current.getZoom(),
          bearing: mapRef.current.getBearing(),
          pitch: mapRef.current.getPitch()
        }
        console.log(`[DeckGLMapView] Saved INITIAL camera state before ground mode:`, preGroundModeCameraRef.current)
      } else {
        console.log(`[DeckGLMapView] Ground position changed, keeping original saved camera state`)
      }

      // Wait 100ms after marker placement, then animate camera
      // Short delay ensures .setCenter() has completed before flyTo starts
      const transitionTimeout = setTimeout(() => {
        console.log(`[DeckGLMapView] 🎬 TIMEOUT EXECUTING - starting camera animation`)

        if (!mapRef.current) {
          console.log(`[DeckGLMapView] ❌ No map reference in timeout, aborting`)
          return
        }

        const initialZoom = 9  // Zoom level for ground view
        const initialPitch = 85  // Look up at data

        // Move camera to a good viewing distance from the data
        // Distance increases aggressively with latitude (quadratic scaling for overhead tracks)
        // At equator: 30km, at 45°: 70km, at 60°: 120km, at 75°: 170km, at poles: 210km
        const absLat = Math.abs(groundModeViewData.nearestLat)
        const latFactor = Math.pow(absLat / 90, 2) // Quadratic scaling - much steeper at high latitudes
        const distanceFromData = 30 + latFactor * 180 // 30km to 210km based on latitude
        const bearing = groundModeViewData.bearing

        // Calculate camera position: distanceFromData away from nearest data point, toward clicked position
        const reverseBearing = (bearing + 180) % 360
        const cameraLat = groundModeViewData.nearestLat
        const cameraLon = groundModeViewData.nearestLon

        // Use haversine to calculate position
        const { lat: finalLat, lon: finalLon } = calculatePointAtDistanceAndBearing(
          cameraLat,
          cameraLon,
          distanceFromData,
          reverseBearing
        )

        console.log(`[DeckGLMapView] 📍 Moving camera to position ${distanceFromData.toFixed(1)}km from data:`)
        console.log(`  Data latitude: ${absLat.toFixed(2)}° (distance scales with latitude)`)
        console.log(`  Camera position: (${finalLat.toFixed(6)}, ${finalLon.toFixed(6)})`)
        console.log(`  Looking at nearest data point: (${cameraLat.toFixed(6)}, ${cameraLon.toFixed(6)})`)
        console.log(`  Bearing: ${groundModeViewData.perpendicularBearing.toFixed(1)}°, Pitch: ${initialPitch}°, Zoom: ${initialZoom}`)

        console.log(`[DeckGLMapView] 🚁 CALLING flyTo with:`, {
          center: [finalLon, finalLat],
          bearing: groundModeViewData.perpendicularBearing,
          pitch: initialPitch,
          zoom: initialZoom
        })

        // IMPORTANT: Stop any ongoing animations before starting flyTo
        // This ensures flyTo starts from a clean state
        console.log(`[DeckGLMapView] 🛑 Stopping any ongoing map animations`)
        mapRef.current.stop()

        // Define zoom handler for dynamic pitch adjustment (will be registered AFTER flyTo completes)
        const handleGroundModeZoom = () => {
          if (!mapRef.current || !isGroundModeActiveRef.current) return

          const currentZoom = mapRef.current.getZoom()
          const currentPitch = mapRef.current.getPitch()

          console.log(`[DeckGLMapView] 📏 Zoom event fired in ground mode: zoom=${currentZoom.toFixed(2)}, pitch=${currentPitch.toFixed(2)}°`)

          // Lower pitch when zoomed in (closer), higher when zoomed out
          // Formula: start at 85° at zoom 9, decrease by 3° per zoom level
          const dynamicPitch = Math.max(60, Math.min(85, 85 - (currentZoom - initialZoom) * 3))

          // Only update if pitch difference is significant (avoid jitter)
          if (Math.abs(currentPitch - dynamicPitch) > 1) {
            console.log(`[DeckGLMapView] 🔧 Adjusting pitch from ${currentPitch.toFixed(1)}° to ${dynamicPitch.toFixed(1)}° (zoom=${currentZoom.toFixed(1)})`)
            mapRef.current.setPitch(dynamicPitch)
          }
        }

        // Add event listeners to track flyTo animation
        const handleMoveStart = () => console.log(`[DeckGLMapView] 🛫 FlyTo animation STARTED`)
        const handleMoveEnd = () => {
          console.log(`[DeckGLMapView] 🛬 FlyTo animation COMPLETED`)

          // Mark camera as settled - this will trigger frustum culling
          console.log(`[DeckGLMapView] ✅ Camera settled at final ground mode position - enabling frustum culling`)
          setGroundModeCameraSettled(true)

          // NOW register the zoom listener AFTER flyTo has completed
          // This prevents the zoom handler from canceling the flyTo animation
          console.log(`[DeckGLMapView] 🎯 flyTo completed, now adding zoom listener for dynamic pitch adjustment`)
          mapRef.current?.on('zoom', handleGroundModeZoom)

          // Store cleanup function
          groundModeZoomCleanupRef.current = () => {
            console.log(`[DeckGLMapView] 🧹 Cleaning up ground mode zoom listener`)
            mapRef.current?.off('zoom', handleGroundModeZoom)
          }
        }
        const handleMove = () => {
          const center = mapRef.current?.getCenter()
          const zoom = mapRef.current?.getZoom()
          const bearing = mapRef.current?.getBearing()
          console.log(`[DeckGLMapView] 🚁 FlyTo in progress: center=(${center?.lat.toFixed(4)}, ${center?.lng.toFixed(4)}), zoom=${zoom?.toFixed(2)}, bearing=${bearing?.toFixed(2)}°`)
        }

        mapRef.current.once('movestart', handleMoveStart)
        mapRef.current.once('moveend', handleMoveEnd)
        mapRef.current.on('move', handleMove)

        // Fly to position near the data with ground-level view
        mapRef.current.flyTo({
          center: [finalLon, finalLat],
          bearing: groundModeViewData.perpendicularBearing, // Look toward nearest data point
          pitch: initialPitch, // Look up at 85° to view data from ground level
          zoom: initialZoom, // Zoom level 9
          duration: 2000, // 2 second transition
          essential: true
        })

        console.log(`[DeckGLMapView] ✅ flyTo command sent - camera should be moving now`)

        // Clean up move listener after animation
        setTimeout(() => {
          mapRef.current?.off('move', handleMove)
        }, 3000)
      }, 100)

      return () => {
        clearTimeout(transitionTimeout)
        // Clean up zoom listener if it exists
        if (groundModeZoomCleanupRef.current) {
          groundModeZoomCleanupRef.current()
          groundModeZoomCleanupRef.current = null
        }
      }
    }, [groundModeViewData])

    // Restore camera when exiting ground mode
    useEffect(() => {
      if (!mapRef.current) return

      // When ground mode is deactivated, restore the previous camera state
      if (!isGroundModeActive && preGroundModeCameraRef.current) {
        console.log(`[DeckGLMapView] Exiting ground mode, restoring camera:`, preGroundModeCameraRef.current)

        // Reset settled state when exiting ground mode
        setGroundModeCameraSettled(false)

        // Clean up zoom listener
        if (groundModeZoomCleanupRef.current) {
          groundModeZoomCleanupRef.current()
          groundModeZoomCleanupRef.current = null
          console.log(`[DeckGLMapView] Cleaned up ground mode zoom listener`)
        }

        mapRef.current.flyTo({
          center: preGroundModeCameraRef.current.center,
          zoom: preGroundModeCameraRef.current.zoom,
          bearing: preGroundModeCameraRef.current.bearing,
          pitch: preGroundModeCameraRef.current.pitch,
          duration: 1500, // 1.5 second transition back
          essential: true
        })

        // Clear the saved state after restoration
        preGroundModeCameraRef.current = null
      }
    }, [isGroundModeActive])

    // Calculate ground mode rectangles when ground mode is activated
    useEffect(() => {
      if (isGroundModeActive && data.length > 0) {
        console.log('[DeckGLMapView] Ground mode activated, calculating guidance rectangles')
        const rectangles = calculateGroundModeRectangles()
        setGroundModeRectangles(rectangles)
      } else {
        // Clear rectangles when ground mode is deactivated
        setGroundModeRectangles(null)
      }
    }, [isGroundModeActive, data])

    // Periodic camera logging every 5 seconds
    useEffect(() => {
      if (!mapRef.current) return

      const logInterval = setInterval(() => {
        if (!mapRef.current) return

        const center = mapRef.current.getCenter()
        const zoom = mapRef.current.getZoom()
        const bearing = mapRef.current.getBearing()
        const pitch = mapRef.current.getPitch()

        console.log('═══════════════════════════════════════════')
        console.log('📹 CAMERA SPECS (5s interval)')
        console.log('═══════════════════════════════════════════')
        console.log(`  Center: (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)})`)
        console.log(`  Zoom: ${zoom.toFixed(2)}`)
        console.log(`  Bearing: ${bearing.toFixed(2)}°`)
        console.log(`  Pitch: ${pitch.toFixed(2)}°`)
        console.log(`  Ground Mode Active: ${isGroundModeActiveRef.current}`)
        if (groundModeViewData) {
          console.log(`  Ground Mode View Data:`)
          console.log(`    Clicked: (${groundModeViewData.clickedLat.toFixed(6)}, ${groundModeViewData.clickedLon.toFixed(6)})`)
          console.log(`    Nearest: (${groundModeViewData.nearestLat.toFixed(6)}, ${groundModeViewData.nearestLon.toFixed(6)})`)
          console.log(`    Nearest Alt: ${groundModeViewData.nearestAlt.toFixed(3)}km`)
          console.log(`    Distance to nearest: ${groundModeViewData.distance.toFixed(2)}km`)
          console.log(`    Bearing to nearest: ${groundModeViewData.bearing.toFixed(2)}°`)
          console.log(`    Camera bearing (perpendicular): ${groundModeViewData.perpendicularBearing.toFixed(2)}°`)
        }
        console.log('═══════════════════════════════════════════')
      }, 5000)

      return () => clearInterval(logInterval)
    }, [groundModeViewData])

    // Visualize polygon vertices (both drawing and completed)
    useEffect(() => {
      if (!mapRef.current) return

      // Clear existing visualization
      clearPolygonVisualization()

      // Show markers for completed polygon (if exists)
      if (completedPolygon && completedPolygon.length > 0) {
        completedPolygon.forEach((vertex, index) => {
          const el = document.createElement('div')
          el.style.width = '20px'
          el.style.height = '20px'
          el.style.cursor = 'default'

          // Yellow markers for completed polygon
          el.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <circle cx="10" cy="10" r="6" fill="#ffff00" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
              <text x="10" y="14" font-size="10" fill="#000000" text-anchor="middle">${index + 1}</text>
            </svg>
          `

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([vertex.lon, vertex.lat])
            .addTo(mapRef.current!)

          polygonMarkersRef.current.push(marker)
        })

        console.log(`[DeckGLMapView] Visualizing completed polygon with ${completedPolygon.length} vertices`)
      }

      // Show markers for vertices being drawn (if any)
      if (polygonVertices.length > 0) {
        polygonVertices.forEach((vertex, index) => {
          const el = document.createElement('div')
          el.style.width = '20px'
          el.style.height = '20px'
          el.style.cursor = 'pointer'

          // Different color for first vertex
          const color = index === 0 ? '#00ff00' : '#ff0000'

          el.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <circle cx="10" cy="10" r="6" fill="${color}" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
              <text x="10" y="14" font-size="10" fill="#ffffff" text-anchor="middle">${index + 1}</text>
            </svg>
          `

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([vertex.lon, vertex.lat])
            .addTo(mapRef.current!)

          polygonMarkersRef.current.push(marker)
        })

        console.log(`[DeckGLMapView] Visualizing ${polygonVertices.length} drawing vertices`)
      }
    }, [polygonVertices, completedPolygon])

    // Manage ground camera marker
    useEffect(() => {
      if (!mapRef.current) return

      // Remove existing marker if present
      if (groundMarkerRef.current) {
        groundMarkerRef.current.remove()
        groundMarkerRef.current = null
      }

      // Create new marker if position is set
      if (groundCameraPosition) {
        // Create a custom marker element
        const el = document.createElement('div')
        el.style.width = '30px'
        el.style.height = '30px'
        el.style.cursor = 'pointer'

        // Create an SVG for the marker (red pin/location icon)
        el.innerHTML = `
          <svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
            <circle cx="15" cy="15" r="8" fill="#ff0000" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
            <circle cx="15" cy="15" r="3" fill="#ffffff" opacity="0.9"/>
          </svg>
        `

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([groundCameraPosition.lon, groundCameraPosition.lat])
          .addTo(mapRef.current)

        groundMarkerRef.current = marker
      }

      // Cleanup on unmount or position change
      return () => {
        if (groundMarkerRef.current) {
          groundMarkerRef.current.remove()
          groundMarkerRef.current = null
        }
      }
    }, [groundCameraPosition])

    return <div ref={mapContainer} className="map-background" />
  }
)

DeckGLMapView.displayName = 'DeckGLMapView'

export default DeckGLMapView
