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
      }
    }))

    // Initialize map
    useEffect(() => {
      if (!mapContainer.current) return

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
      const updateCenter = () => {
        if (mapRef.current) {
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

    // Update deck.gl layers when data or settings change
    useEffect(() => {
      if (!deckOverlayRef.current || data.length === 0) return

      // Prepare data for deck.gl - subsample to 1 in 10 points for better visibility
      const subsampleRate = 10
      const points: Array<{ position: [number, number, number], color: [number, number, number] }> = []

      data.forEach((dataset, datasetIndex) => {
        for (let i = 0; i < dataset.positions.length; i += 3) {
          if ((i / 3) % subsampleRate !== 0) continue

          const lon = dataset.positions[i]
          const lat = dataset.positions[i + 1]
          const alt = dataset.positions[i + 2] * 1000 // Convert km to meters

          const colorIndex = i // colors array has same indexing as positions
          // dataset.colors is already Uint8Array with 0-255 values, no need to multiply
          const r = dataset.colors[colorIndex]
          const g = dataset.colors[colorIndex + 1]
          const b = dataset.colors[colorIndex + 2]

          points.push({
            position: [lon, lat, alt],
            color: [r, g, b]
          })
        }
      })

      console.log('[DeckGLMapView] Creating layer with', points.length, 'points')
      console.log('[DeckGLMapView] Sample colors:', points.slice(0, 5).map(p => p.color))
      console.log('[DeckGLMapView] ColorMode:', colorMode, 'Colormap:', colormap, 'DataVersion:', dataVersion)

      // Create scatterplot layer
      const layer = new ScatterplotLayer({
        id: 'point-cloud',
        data: points,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        getRadius: pointSize * 100, // Scale for meters
        radiusUnits: 'meters',
        radiusMinPixels: pointSize * 2,
        radiusMaxPixels: pointSize * 5,
        opacity: 0.8,
        pickable: false
      })

      deckOverlayRef.current.setProps({ layers: [layer] })
    }, [data, colorMode, colormap, pointSize, dataVersion])

    return <div ref={mapContainer} className="map-background" />
  }
)

DeckGLMapView.displayName = 'DeckGLMapView'

export default DeckGLMapView
