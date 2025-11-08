import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, LineLayer, IconLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
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
  ({ center, zoom = 5, data, colorMode, colormap, pointSize, dataVersion, isDrawingAOI, aoiPolygon, onPolygonComplete, onAnimationProgress, onCurrentGpsTime, onCurrentPosition, animationProgress = 1.0, isGroundModeActive, groundCameraPosition, onGroundCameraPositionSet }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const deckOverlayRef = useRef<MapboxOverlay | null>(null)
    const drawRef = useRef<MapboxDraw | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [satellitePosition, setSatellitePosition] = useState<[number, number, number] | null>(null)
    const [laserLine, setLaserLine] = useState<[[number, number, number], [number, number, number]] | null>(null)
    const [satelliteIcon, setSatelliteIcon] = useState<string | null>(null)
    const lastCenterPropRef = useRef<[number, number] | null>(null)
    const groundMarkerRef = useRef<maplibregl.Marker | null>(null)

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
        if (drawRef.current) {
          if (enabled) {
            drawRef.current.changeMode('draw_polygon')
          } else {
            drawRef.current.changeMode('simple_select')
          }
        }
      },
      clearPolygon: () => {
        if (drawRef.current) {
          drawRef.current.deleteAll()
        }
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

      // Initialize MapboxDraw for polygon drawing
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'simple_select'
      })
      map.addControl(draw as any)
      drawRef.current = draw

      // Listen for polygon creation
      map.on('draw.create', (e: any) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0]
          if (feature.geometry.type === 'Polygon') {
            // Convert GeoJSON coordinates to LatLon format
            const coords = feature.geometry.coordinates[0] // First ring of polygon
            const latLonArray: LatLon[] = coords.slice(0, -1).map((coord: number[]) => ({
              lon: coord[0],
              lat: coord[1]
            }))
            onPolygonComplete?.(latLonArray)
            setIsDrawing(false)
          }
        }
      })

      // Handle ground mode clicks
      const handleMapClick = (e: maplibregl.MapMouseEvent) => {
        // Only handle clicks when ground mode is active and not in drawing mode
        if (isGroundModeActive && !isDrawing && onGroundCameraPositionSet) {
          const { lng, lat } = e.lngLat
          onGroundCameraPositionSet(lat, lng)
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

    // Handle drawing mode changes
    useEffect(() => {
      if (!drawRef.current || isDrawingAOI === undefined) return

      if (isDrawingAOI) {
        drawRef.current.changeMode('draw_polygon')
      } else {
        drawRef.current.changeMode('simple_select')
      }
    }, [isDrawingAOI])

    // Clear polygon when aoiPolygon is null
    useEffect(() => {
      if (drawRef.current && aoiPolygon === null) {
        drawRef.current.deleteAll()
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
    }, [data, colorMode, colormap, pointSize, dataVersion, currentZoom, animationProgress, laserLine, satellitePosition, satelliteIcon])

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
