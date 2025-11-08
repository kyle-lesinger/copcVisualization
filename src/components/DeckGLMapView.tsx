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

    // Refs for ground mode to avoid stale closures in click handler
    const isGroundModeActiveRef = useRef(isGroundModeActive)
    const isDrawingAOIRef = useRef(isDrawingAOI)
    const onGroundCameraPositionSetRef = useRef(onGroundCameraPositionSet)

    // Store camera state before ground mode for restoration
    const preGroundModeCameraRef = useRef<{
      center: [number, number]
      zoom: number
      bearing: number
      pitch: number
    } | null>(null)

    // Keep refs in sync with props
    useEffect(() => {
      isGroundModeActiveRef.current = isGroundModeActive
      isDrawingAOIRef.current = isDrawingAOI
      onGroundCameraPositionSetRef.current = onGroundCameraPositionSet
      onPolygonCompleteRef.current = onPolygonComplete
    }, [isGroundModeActive, isDrawingAOI, onGroundCameraPositionSet, onPolygonComplete])

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
          onGroundCameraPositionSetRef.current(lat, lng)
        }
      }
      map.on('click', handleMapClick)

      return () => {
        map.off('click', handleMapClick)
        map.remove()
      }
    }, [])

    // Update center when prop changes
    useEffect(() => {
      if (!mapRef.current) return

      // Check if the prop actually changed from its previous value
      const threshold = 0.0001 // ~10 meters tolerance
      const propChanged = !lastCenterPropRef.current ||
                         Math.abs(lastCenterPropRef.current[0] - center[0]) > threshold ||
                         Math.abs(lastCenterPropRef.current[1] - center[1]) > threshold

      if (!propChanged) {
        // Prop didn't change, don't update the map
        return
      }

      console.log(`[DeckGLMapView] Center prop changed from (${lastCenterPropRef.current?.[0].toFixed(4) ?? 'null'}, ${lastCenterPropRef.current?.[1].toFixed(4) ?? 'null'}) to (${center[0].toFixed(4)}, ${center[1].toFixed(4)})`)

      const updateCenter = () => {
        if (mapRef.current) {
          console.log(`[DeckGLMapView] Applying center update to map`)
          mapRef.current.setCenter([center[0], center[1]])
          lastCenterPropRef.current = [center[0], center[1]]
        }
      }

      if (mapRef.current.loaded()) {
        updateCenter()
      } else {
        mapRef.current.once('load', updateCenter)
      }
    }, [center])

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

    // Get subsample rate based on zoom level - all points by zoom 10
    const getSubsampleRate = (zoom: number): number => {
      if (zoom < 4) return 500       // ~920 points - far away
      if (zoom < 6) return 200       // ~2,300 points
      if (zoom < 8) return 50        // ~9,200 points
      if (zoom < 9) return 10        // ~46,000 points
      if (zoom < 10) return 2        // ~230,000 points
      return 1                        // All ~460,000 points at zoom 10+
    }

    // Update deck.gl layers when data or settings change
    useEffect(() => {
      if (!deckOverlayRef.current || data.length === 0) return

      // Get subsample rate based on current zoom level
      const subsampleRate = getSubsampleRate(currentZoom)
      const useAveraging = currentZoom < 9 // Use averaging when zoomed out (below zoom 9)
      const neighborCount = 40 // Number of neighbors to average

      console.log(`[DeckGLMapView] Zoom ${currentZoom.toFixed(1)}, subsample rate: 1:${subsampleRate}, averaging: ${useAveraging}`)

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

      console.log('[DeckGLMapView] Creating layer with', visiblePoints.length, '/', points.length, `points (${(animationProgress * 100).toFixed(1)}% progress)`)
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
    }, [data, colorMode, colormap, pointSize, dataVersion, currentZoom, animationProgress, laserLine, satellitePosition, satelliteIcon, polygonVertices, completedPolygon])

    // Ground mode camera transition - create first-person ground view
    useEffect(() => {
      if (!mapRef.current || !groundModeViewData) return

      console.log(`[DeckGLMapView] Ground mode transition triggered: bearing=${groundModeViewData.perpendicularBearing.toFixed(1)}°, distance=${groundModeViewData.distance.toFixed(2)}km`)

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

      // Wait 500ms after marker placement, then animate camera
      const transitionTimeout = setTimeout(() => {
        if (!mapRef.current) return

        // Fly to clicked position with ground-level view
        mapRef.current.flyTo({
          center: [groundModeViewData.clickedLon, groundModeViewData.clickedLat],
          bearing: groundModeViewData.perpendicularBearing, // Look directly at data curtain
          pitch: 85, // Look nearly straight up at data curtain
          zoom: 12, // Appropriate zoom for ground view
          duration: 2000, // 2 second transition
          essential: true
        })

        console.log(`[DeckGLMapView] Ground mode view activated at (${groundModeViewData.clickedLat.toFixed(4)}, ${groundModeViewData.clickedLon.toFixed(4)})`)
      }, 500)

      return () => clearTimeout(transitionTimeout)
    }, [groundModeViewData])

    // Restore camera when exiting ground mode
    useEffect(() => {
      if (!mapRef.current) return

      // When ground mode is deactivated, restore the previous camera state
      if (!isGroundModeActive && preGroundModeCameraRef.current) {
        console.log(`[DeckGLMapView] Exiting ground mode, restoring camera:`, preGroundModeCameraRef.current)

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
