import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
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
}

export interface DeckGLMapViewHandle {
  setCenter: (lng: number, lat: number) => void
  setZoom: (zoom: number) => void
  getMap: () => maplibregl.Map | null
  setDrawingMode: (enabled: boolean) => void
  clearPolygon: () => void
  getMapState: () => { center: [number, number], zoom: number } | null
}

const DeckGLMapView = forwardRef<DeckGLMapViewHandle, DeckGLMapViewProps>(
  ({ center, zoom = 5, data, colorMode, colormap, pointSize, dataVersion, isDrawingAOI, aoiPolygon, onPolygonComplete }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const deckOverlayRef = useRef<MapboxOverlay | null>(null)
    const drawRef = useRef<MapboxDraw | null>(null)
    const [isDrawing, setIsDrawing] = useState(false)

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
      }
    }))

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

      return () => {
        map.remove()
      }
    }, [])

    // Update center when prop changes
    useEffect(() => {
      if (!mapRef.current) return
      console.log(`[DeckGLMapView] Center prop changed to (${center[0].toFixed(2)}, ${center[1].toFixed(2)})`)
      const updateCenter = () => {
        if (mapRef.current) {
          console.log(`[DeckGLMapView] Updating map center to (${center[0].toFixed(2)}, ${center[1].toFixed(2)})`)
          mapRef.current.setCenter([center[0], center[1]])
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

      console.log('[DeckGLMapView] Creating layer with', points.length, 'points (subsampled from', data[0].positions.length / 3, ')')
      console.log('[DeckGLMapView] Sample colors:', points.slice(0, 5).map(p => p.color))
      console.log('[DeckGLMapView] ColorMode:', colorMode, 'Colormap:', colormap, 'DataVersion:', dataVersion)

      // Create scatterplot layer with round, billboard-facing points
      const layer = new ScatterplotLayer({
        id: 'point-cloud',
        data: points,
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

      deckOverlayRef.current.setProps({ layers: [layer] })
    }, [data, colorMode, colormap, pointSize, dataVersion, currentZoom])

    return <div ref={mapContainer} className="map-background" />
  }
)

DeckGLMapView.displayName = 'DeckGLMapView'

export default DeckGLMapView
