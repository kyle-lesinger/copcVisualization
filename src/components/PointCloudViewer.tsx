import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { ColorMode, Colormap, DataRange, ViewMode, HeightFilter } from '../App'
import {
  loadCOPCFile,
  PointCloudData,
  computeElevationColors,
  computeIntensityColors,
  computeClassificationColors
} from '../utils/copcLoader'
import { convertPointsToGlobe, convertPointsTo2D } from '../utils/coordinateConversion'
import { LatLon, filterDataByAOI } from '../utils/aoiSelector'
import GlobeViewer, { GlobeViewerHandle } from './GlobeViewer'
import DeckGLMapView, { DeckGLMapViewHandle } from './DeckGLMapView'
import AOIScatterPlot from './AOIScatterPlot'
import './PointCloudViewer.css'

interface PointCloudViewerProps {
  files: string[]
  colorMode: ColorMode
  colormap: Colormap
  pointSize: number
  viewMode: ViewMode
  onGlobalDataRangeUpdate: (range: DataRange) => void
  onDataRangeUpdate: (range: DataRange) => void
  aoiPolygon: LatLon[] | null
  showScatterPlotTrigger?: boolean
  onAOIDataReady?: (hasData: boolean, pointCount?: number) => void
  onPolygonUpdate?: (polygon: LatLon[]) => void
  isDrawingAOI?: boolean
  onAnimateSatelliteTrigger?: number
  onFirstPointUpdate?: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null) => void
  onLastPointUpdate?: (lastPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null) => void
  onCurrentGpsTimeUpdate?: (gpsTime: number | null) => void
  onCurrentPositionUpdate?: (lat: number, lon: number) => void
  heightFilter?: HeightFilter
}

export default function PointCloudViewer({ files, colorMode, colormap, pointSize, viewMode, onGlobalDataRangeUpdate, onDataRangeUpdate, aoiPolygon, showScatterPlotTrigger, onAOIDataReady, onPolygonUpdate, isDrawingAOI, onAnimateSatelliteTrigger, onFirstPointUpdate, onLastPointUpdate, onCurrentGpsTimeUpdate, onCurrentPositionUpdate, heightFilter }: PointCloudViewerProps) {
  const globeRef = useRef<GlobeViewerHandle>(null)
  const deckMapRef = useRef<DeckGLMapViewHandle>(null)
  const pointCloudsRef = useRef<THREE.Points[]>([])
  const dataRef = useRef<PointCloudData[]>([])
  const displayedPositionsRef = useRef<Float32Array | null>(null) // Track decimated positions for satellite animation
  const lastCameraDistanceRef = useRef<number>(3.0) // Default camera distance
  const animationFrameRef = useRef<number | null>(null)

  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ points: 0, files: 0 })
  const [globalRanges, setGlobalRanges] = useState<{
    elevation: [number, number] | null
    intensity: [number, number] | null
  }>({
    elevation: null,
    intensity: null
  })
  const [filteredRanges, setFilteredRanges] = useState<{
    elevation: [number, number] | null
    intensity: [number, number] | null
  }>({
    elevation: null,
    intensity: null
  })
  const [mapCenter, setMapCenter] = useState<[number, number]>([0, 0])
  const [mapZoom, setMapZoom] = useState<number>(5)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [dataVersion, setDataVersion] = useState(0) // Increment to trigger DeckGLMapView update
  const [mapViewKey, setMapViewKey] = useState(0) // Increment to force DeckGLMapView remount
  const last2DMapStateRef = useRef<{ center: [number, number], zoom: number } | null>(null)
  const last3DCameraStateRef = useRef<{ distance: number, target: { lon: number, lat: number } } | null>(null)
  const lastColorSettingsRef = useRef<{ colorMode: ColorMode, colormap: Colormap } | null>(null)
  const lastViewModeRef = useRef<ViewMode>(viewMode)

  // Store decimated data per point cloud for fast color updates
  const decimatedDataRef = useRef<Array<{
    positions: Float32Array
    intensities: Uint16Array
    classifications: Uint8Array
  }>>([])


  // Track 3D camera state continuously when in 3D mode (only after data loads)
  useEffect(() => {
    if (viewMode === '2d' || !globeRef.current || !dataLoaded) return

    const updateCameraState = () => {
      if (globeRef.current) {
        const cameraState = globeRef.current.getCameraState()
        if (cameraState) {
          // Only update if target is not at origin (indicates valid position)
          if (cameraState.target.lon !== 0 || cameraState.target.lat !== 0) {
            last3DCameraStateRef.current = cameraState
          }
        }
      }
    }

    // Update every 500ms while in 3D mode
    const interval = setInterval(updateCameraState, 500)
    updateCameraState() // Initial update

    return () => clearInterval(interval)
  }, [viewMode, dataLoaded])

  // Track 2D map state continuously when in 2D mode
  useEffect(() => {
    if (viewMode !== '2d' || !deckMapRef.current) return

    const updateMapState = () => {
      if (deckMapRef.current) {
        const mapState = deckMapRef.current.getMapState()
        if (mapState) {
          const prev = last2DMapStateRef.current
          const changed = !prev ||
            Math.abs(prev.center[0] - mapState.center[0]) > 0.001 ||
            Math.abs(prev.center[1] - mapState.center[1]) > 0.001 ||
            Math.abs(prev.zoom - mapState.zoom) > 0.01

          if (changed) {
            console.log(`[PointCloudViewer] 2D map tracking: center (${mapState.center[0].toFixed(4)}, ${mapState.center[1].toFixed(4)}), zoom ${mapState.zoom.toFixed(4)}`)
          }

          last2DMapStateRef.current = { center: mapState.center, zoom: mapState.zoom }
        }
      }
    }

    // Update every 500ms while in 2D mode
    const interval = setInterval(updateMapState, 500)
    updateMapState() // Initial update

    return () => clearInterval(interval)
  }, [viewMode])

  // AOI scatter plot state
  const [showScatterPlot, setShowScatterPlot] = useState(false)
  const [aoiData, setAoiData] = useState<{ altitudes: number[], intensities: number[] } | null>(null)

  // First and last point state for satellite animation
  const [firstPoint, setFirstPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [lastPoint, setLastPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [animationProgress, setAnimationProgress] = useState(1) // Start at 1 to show all points initially

  // Get decimation factor based on camera distance from globe center
  const getDecimationForDistance = useCallback((distance: number): number => {
    // Earth radius is 1.0, so distance is from origin
    // When zoomed out (distance > 3): fewer points
    // When zoomed in (distance < 1.5): more points

    if (distance > 5.0) return 100      // Very far: ~46,000 points
    if (distance > 3.5) return 50       // Far: ~93,000 points
    if (distance > 2.5) return 20       // Medium: ~232,000 points
    if (distance > 1.8) return 10       // Close: ~465,000 points
    if (distance > 1.3) return 5        // Very close: ~930,000 points
    if (distance > 1.1) return 2        // Extremely close: ~2.3M points
    return 1                             // At surface: All points (~4.6M)
  }, [])

  // Helper function to filter points by height
  const filterPointsByHeight = useCallback((data: PointCloudData): PointCloudData => {
    // If height filter is disabled, return original data
    if (!heightFilter || !heightFilter.enabled) {
      return data
    }

    const { min, max } = heightFilter
    const filteredIndices: number[] = []

    // Find all points within height range
    for (let i = 0; i < data.positions.length; i += 3) {
      const altitude = data.positions[i + 2] // Z coordinate = altitude in km
      if (altitude >= min && altitude <= max) {
        filteredIndices.push(i / 3) // Store point index (not position index)
      }
    }

    // If no points pass the filter, return empty arrays
    if (filteredIndices.length === 0) {
      return {
        ...data,
        positions: new Float32Array(0),
        colors: new Uint8Array(0),
        intensities: new Uint16Array(0),
        classifications: new Uint8Array(0),
        count: 0
      }
    }

    // Create filtered arrays
    const filteredPositions = new Float32Array(filteredIndices.length * 3)
    const filteredColors = new Uint8Array(filteredIndices.length * 3)
    const filteredIntensities = new Uint16Array(filteredIndices.length)
    const filteredClassifications = new Uint8Array(filteredIndices.length)

    filteredIndices.forEach((pointIndex, newIndex) => {
      // Copy position (3 values per point)
      filteredPositions[newIndex * 3] = data.positions[pointIndex * 3]
      filteredPositions[newIndex * 3 + 1] = data.positions[pointIndex * 3 + 1]
      filteredPositions[newIndex * 3 + 2] = data.positions[pointIndex * 3 + 2]

      // Copy color (3 values per point)
      filteredColors[newIndex * 3] = data.colors[pointIndex * 3]
      filteredColors[newIndex * 3 + 1] = data.colors[pointIndex * 3 + 1]
      filteredColors[newIndex * 3 + 2] = data.colors[pointIndex * 3 + 2]

      // Copy intensity (1 value per point)
      filteredIntensities[newIndex] = data.intensities[pointIndex]

      // Copy classification (1 value per point)
      filteredClassifications[newIndex] = data.classifications[pointIndex]
    })

    return {
      ...data,
      positions: filteredPositions,
      colors: filteredColors,
      intensities: filteredIntensities,
      classifications: filteredClassifications,
      count: filteredIndices.length
    }
  }, [heightFilter])

  // Update globe LOD based on camera distance
  const updateGlobeLOD = useCallback(() => {
    if (!globeRef.current || dataRef.current.length === 0 || viewMode === '2d') return

    const camera = globeRef.current.getCamera()
    const scene = globeRef.current.getScene()
    if (!camera || !scene) return

    // Calculate distance from camera to globe center (origin)
    const distance = camera.position.length()
    const distanceDelta = Math.abs(distance - lastCameraDistanceRef.current)

    // Update LOD if distance changed by more than 0.3 units
    if (distanceDelta > 0.3) {
      const newDecimation = getDecimationForDistance(distance)
      const oldDecimation = getDecimationForDistance(lastCameraDistanceRef.current)

      // Only rebuild if decimation factor changed
      if (newDecimation !== oldDecimation) {
        console.log(`[PointCloudViewer] Globe LOD update: distance ${lastCameraDistanceRef.current.toFixed(2)} -> ${distance.toFixed(2)}, decimation ${oldDecimation} -> ${newDecimation}`)

        lastCameraDistanceRef.current = distance

        // Remove existing point clouds
        pointCloudsRef.current.forEach(pc => {
          scene.remove(pc)
          pc.geometry.dispose()
          if (pc.material instanceof THREE.Material) {
            pc.material.dispose()
          }
        })
        pointCloudsRef.current = []
        decimatedDataRef.current = [] // Clear decimated data for rebuild

        // Recreate point clouds with new decimation
        let totalPoints = 0
        dataRef.current.forEach((data, dataIndex) => {
          // Apply height filter
          const filteredData = filterPointsByHeight(data)

          // Use new decimation based on current distance
          const decimation = newDecimation
          const decimatedPositions: number[] = []
          const decimatedIntensities: number[] = []
          const decimatedClassifications: number[] = []

          for (let i = 0; i < filteredData.positions.length; i += 3) {
            if ((i / 3) % decimation === 0) {
              const pointIndex = i / 3
              decimatedPositions.push(
                filteredData.positions[i],
                filteredData.positions[i + 1],
                filteredData.positions[i + 2]
              )
              decimatedIntensities.push(filteredData.intensities[pointIndex])
              decimatedClassifications.push(filteredData.classifications[pointIndex])
            }
          }

          console.log(`[PointCloudViewer] LOD rebuild: ${data.positions.length / 3} points → (height filter) → ${filteredData.positions.length / 3} points → (decimation 1:${decimation}) → ${decimatedPositions.length / 3} points`)

          // Recompute colors based on current color mode
          const decimatedColors = new Uint8Array(decimatedPositions.length)
          const decimatedPositionsArray = new Float32Array(decimatedPositions)
          const decimatedIntensitiesArray = new Uint16Array(decimatedIntensities)
          const decimatedClassificationsArray = new Uint8Array(decimatedClassifications)

          // Store decimated positions for satellite animation (first dataset only)
          if (dataIndex === 0) {
            displayedPositionsRef.current = decimatedPositionsArray
          }

          // Determine which ranges to use for coloring
          const activeRanges = (heightFilter?.enabled && filteredRanges.elevation && filteredRanges.intensity)
            ? filteredRanges
            : globalRanges

          // Only compute colors if ranges are available
          if (activeRanges.elevation && activeRanges.intensity) {
            switch (colorMode) {
              case 'elevation':
                computeElevationColors(
                  decimatedPositionsArray,
                  decimatedColors,
                  activeRanges.elevation[0],
                  activeRanges.elevation[1],
                  colormap
                )
                break
              case 'intensity':
                computeIntensityColors(
                  decimatedIntensitiesArray,
                  decimatedColors,
                  activeRanges.intensity[0],
                  activeRanges.intensity[1],
                  colormap,
                  true // Use CALIPSO scaling
                )
                break
              case 'classification':
                computeClassificationColors(decimatedClassificationsArray, decimatedColors)
                break
            }
          }

          // Store decimated data for fast color updates
          if (!decimatedDataRef.current[dataIndex]) {
            decimatedDataRef.current[dataIndex] = {
              positions: decimatedPositionsArray,
              intensities: decimatedIntensitiesArray,
              classifications: decimatedClassificationsArray
            }
          } else {
            decimatedDataRef.current[dataIndex].positions = decimatedPositionsArray
            decimatedDataRef.current[dataIndex].intensities = decimatedIntensitiesArray
            decimatedDataRef.current[dataIndex].classifications = decimatedClassificationsArray
          }

          // Convert to globe coordinates
          const globePositions = convertPointsToGlobe(decimatedPositionsArray)

          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
          geometry.setAttribute('color', new THREE.BufferAttribute(decimatedColors, 3, true))

          const material = new THREE.PointsMaterial({
            size: pointSize * 0.002,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8
          })

          const points = new THREE.Points(geometry, material)
          scene.add(points)
          pointCloudsRef.current.push(points)

          totalPoints += decimatedPositions.length / 3
        })

        setStats(prev => ({ ...prev, points: totalPoints }))
      }
    }
  }, [viewMode, filterPointsByHeight, getDecimationForDistance, pointSize, colorMode, colormap, globalRanges, filteredRanges])

  // Fast color-only update for 3D view (no point cloud rebuild)
  const updateColors3D = useCallback(() => {
    if (!globeRef.current || pointCloudsRef.current.length === 0) return

    // Determine which ranges to use for coloring
    const activeRanges = (heightFilter?.enabled && filteredRanges.elevation && filteredRanges.intensity)
      ? filteredRanges
      : globalRanges

    // Only update if ranges are available
    if (!activeRanges.elevation || !activeRanges.intensity) return

    console.log('[PointCloudViewer] Fast color update for 3D view, colorMode:', colorMode, 'colormap:', colormap)

    // Update colors for each point cloud
    pointCloudsRef.current.forEach((pointCloud, index) => {
      const decimatedData = decimatedDataRef.current[index]
      if (!decimatedData) return

      // Get the color attribute from the geometry
      const colorAttribute = pointCloud.geometry.getAttribute('color') as THREE.BufferAttribute
      if (!colorAttribute) return

      const colors = new Uint8Array(colorAttribute.array.length)

      // Recompute colors based on current color mode
      switch (colorMode) {
        case 'elevation':
          computeElevationColors(
            decimatedData.positions,
            colors,
            activeRanges.elevation![0],
            activeRanges.elevation![1],
            colormap
          )
          break
        case 'intensity':
          computeIntensityColors(
            decimatedData.intensities,
            colors,
            activeRanges.intensity![0],
            activeRanges.intensity![1],
            colormap,
            true // Use CALIPSO scaling
          )
          break
        case 'classification':
          computeClassificationColors(decimatedData.classifications, colors)
          break
      }

      // Update the color attribute
      colorAttribute.array = colors
      colorAttribute.needsUpdate = true
    })
  }, [colorMode, colormap, heightFilter, filteredRanges, globalRanges])

  // Start monitoring camera distance for LOD updates
  useEffect(() => {
    if (viewMode !== 'space' || !globeRef.current) return

    const updateLoop = () => {
      updateGlobeLOD()
      animationFrameRef.current = requestAnimationFrame(updateLoop)
    }

    updateLoop()

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [viewMode, updateGlobeLOD])

  // Memoized filtered data for 2D map view
  // Uses dataVersion as dependency since dataRef.current changes don't trigger re-renders
  const filteredDataForMap = useMemo(() => {
    return dataRef.current.map(data => filterPointsByHeight(data))
  }, [dataVersion, heightFilter, filterPointsByHeight])

  // Function to compute ranges from filtered data
  const computeFilteredRanges = useCallback(() => {
    if (!heightFilter || !heightFilter.enabled || dataRef.current.length === 0) {
      // If filter is off, use global ranges
      setFilteredRanges(globalRanges)
      onDataRangeUpdate(globalRanges)
      return
    }

    // Calculate ranges from filtered data only
    let minElev = Infinity
    let maxElev = -Infinity
    let minIntPhysical = Infinity
    let maxIntPhysical = -Infinity

    dataRef.current.forEach((data) => {
      const filtered = filterPointsByHeight(data)

      // Elevation range from filtered positions
      for (let i = 0; i < filtered.positions.length; i += 3) {
        const alt = filtered.positions[i + 2]
        minElev = Math.min(minElev, alt)
        maxElev = Math.max(maxElev, alt)
      }

      // Intensity range from filtered intensities
      for (let i = 0; i < filtered.intensities.length; i++) {
        const lasIntensity = filtered.intensities[i]
        const physical = (lasIntensity / 10000.0) - 0.1
        minIntPhysical = Math.min(minIntPhysical, physical)
        maxIntPhysical = Math.max(maxIntPhysical, physical)
      }
    })

    // Handle case where no points pass the filter
    if (minElev === Infinity || maxElev === -Infinity) {
      const ranges = {
        elevation: heightFilter ? [heightFilter.min, heightFilter.max] as [number, number] : null,
        intensity: null
      }
      setFilteredRanges(ranges)
      onDataRangeUpdate(ranges)
      return
    }

    const ranges = {
      elevation: [minElev, maxElev] as [number, number],
      intensity: [minIntPhysical, maxIntPhysical] as [number, number]
    }
    setFilteredRanges(ranges)
    onDataRangeUpdate(ranges)
  }, [heightFilter, filterPointsByHeight, globalRanges, onDataRangeUpdate])

  // Globe viewer is initialized by the GlobeViewer component

  // Load COPC files
  useEffect(() => {
    if (!globeRef.current || files.length === 0) return

    const scene = globeRef.current.getScene()
    if (!scene) return

    // Remove existing point clouds
    pointCloudsRef.current.forEach(pc => {
      scene.remove(pc)
      pc.geometry.dispose()
      if (pc.material instanceof THREE.Material) {
        pc.material.dispose()
      }
    })
    pointCloudsRef.current = []
    dataRef.current = []

    setLoading(true)
    setError(null)
    setLoadingProgress(0)

    // Load all files
    Promise.all(
      files.map((file, index) =>
        loadCOPCFile(file, (progress) => {
          setLoadingProgress((prev) => {
            const fileProgress = progress / files.length
            const previousFilesProgress = index / files.length
            return Math.min(100, (previousFilesProgress + fileProgress) * 100)
          })
        })
      )
    )
      .then((allData) => {
        dataRef.current = allData

        // Store first and last points from first file for satellite animation
        if (allData.length > 0) {
          if (allData[0].firstPoint) {
            setFirstPoint(allData[0].firstPoint)
          }
          if (allData[0].lastPoint) {
            setLastPoint(allData[0].lastPoint)
          }
        }

        // Compute global ranges across all files
        let minElev = Infinity
        let maxElev = -Infinity
        let minIntPhysical = Infinity
        let maxIntPhysical = -Infinity

        allData.forEach((data) => {
          // Elevation range from positions (Z coordinate = altitude in km)
          for (let i = 0; i < data.positions.length; i += 3) {
            const alt = data.positions[i + 2]
            minElev = Math.min(minElev, alt)
            maxElev = Math.max(maxElev, alt)
          }

          // Intensity range - convert from LAS encoding to physical units
          // CALIPSO encoding: intensity = (physical + 0.1) * 10000
          // Physical units: km⁻¹·sr⁻¹
          for (let i = 0; i < data.intensities.length; i++) {
            const lasIntensity = data.intensities[i]
            const physical = (lasIntensity / 10000.0) - 0.1
            minIntPhysical = Math.min(minIntPhysical, physical)
            maxIntPhysical = Math.max(maxIntPhysical, physical)
          }
        })

        const ranges = {
          elevation: [minElev, maxElev] as [number, number],
          intensity: [minIntPhysical, maxIntPhysical] as [number, number]
        }
        setGlobalRanges(ranges)
        setFilteredRanges(ranges) // Initially, filtered ranges = global ranges
        onGlobalDataRangeUpdate(ranges) // Set the global data range that never changes
        onDataRangeUpdate(ranges) // Set the current data range

        // Compute colors for original data (needed for 2D view)
        allData.forEach((data) => {
          switch (colorMode) {
            case 'elevation':
              computeElevationColors(
                data.positions,
                data.colors,
                ranges.elevation[0],
                ranges.elevation[1],
                colormap
              )
              break
            case 'intensity':
              computeIntensityColors(
                data.intensities,
                data.colors,
                ranges.intensity[0],
                ranges.intensity[1],
                colormap,
                true // Use CALIPSO scaling
              )
              break
            case 'classification':
              computeClassificationColors(data.classifications, data.colors)
              break
          }
        })

        // Calculate map center from first file's data
        let minLng = Infinity, maxLng = -Infinity
        let minLat = Infinity, maxLat = -Infinity
        for (let i = 0; i < allData[0].positions.length; i += 3) {
          const lon = allData[0].positions[i]
          const lat = allData[0].positions[i + 1]
          minLng = Math.min(minLng, lon)
          maxLng = Math.max(maxLng, lon)
          minLat = Math.min(minLat, lat)
          maxLat = Math.max(maxLat, lat)
        }
        const centerLng = (minLng + maxLng) / 2
        const centerLat = (minLat + maxLat) / 2
        setMapCenter([centerLng, centerLat])

        // Create point clouds for each file
        let totalPoints = 0
        allData.forEach((data, dataIndex) => {
          // Don't apply height filter on initial load - it will be applied by the height filter effect
          // This prevents reloading data every time the height filter changes

          // Distance-based decimation for globe view
          // Start with medium detail (1:10), will be updated based on camera distance
          const decimation = getDecimationForDistance(3.0) // Default camera distance
          const decimatedPositions: number[] = []
          const decimatedIntensities: number[] = []
          const decimatedClassifications: number[] = []

          for (let i = 0; i < data.positions.length; i += 3) {
            if ((i / 3) % decimation === 0) {
              const pointIndex = i / 3
              decimatedPositions.push(
                data.positions[i],
                data.positions[i + 1],
                data.positions[i + 2]
              )
              decimatedIntensities.push(data.intensities[pointIndex])
              decimatedClassifications.push(data.classifications[pointIndex])
            }
          }

          console.log(`[PointCloudViewer] Globe initial load: ${data.positions.length / 3} points → (decimation 1:${decimation}) → ${decimatedPositions.length / 3} points (height filter will be applied separately)`)

          // Convert lat/lon/alt coordinates to 3D globe coordinates
          const decimatedPositionsArray = new Float32Array(decimatedPositions)
          const decimatedIntensitiesArray = new Uint16Array(decimatedIntensities)
          const decimatedClassificationsArray = new Uint8Array(decimatedClassifications)

          // Compute colors for decimated points
          const decimatedColors = new Uint8Array(decimatedPositions.length)
          switch (colorMode) {
            case 'elevation':
              computeElevationColors(
                decimatedPositionsArray,
                decimatedColors,
                ranges.elevation[0],
                ranges.elevation[1],
                colormap
              )
              break
            case 'intensity':
              computeIntensityColors(
                decimatedIntensitiesArray,
                decimatedColors,
                ranges.intensity[0],
                ranges.intensity[1],
                colormap,
                true // Use CALIPSO scaling
              )
              break
            case 'classification':
              computeClassificationColors(decimatedClassificationsArray, decimatedColors)
              break
          }

          // Store decimated data for fast color updates
          if (!decimatedDataRef.current[dataIndex]) {
            decimatedDataRef.current[dataIndex] = {
              positions: decimatedPositionsArray,
              intensities: decimatedIntensitiesArray,
              classifications: decimatedClassificationsArray
            }
          } else {
            decimatedDataRef.current[dataIndex].positions = decimatedPositionsArray
            decimatedDataRef.current[dataIndex].intensities = decimatedIntensitiesArray
            decimatedDataRef.current[dataIndex].classifications = decimatedClassificationsArray
          }

          // Store decimated positions for satellite animation (first dataset only)
          if (dataIndex === 0) {
            displayedPositionsRef.current = decimatedPositionsArray
          }

          const globePositions = convertPointsToGlobe(decimatedPositionsArray)

          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
          geometry.setAttribute('color', new THREE.BufferAttribute(decimatedColors, 3, true))

          const material = new THREE.PointsMaterial({
            size: pointSize * 0.002, // Scale for globe view
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8
          })

          const points = new THREE.Points(geometry, material)
          scene.add(points)
          pointCloudsRef.current.push(points)

          totalPoints += decimatedPositions.length / 3
        })

        setStats({ points: totalPoints, files: allData.length })
        setLoading(false)
        setDataLoaded(true)
        // Increment dataVersion to trigger DeckGLMapView update with new data
        setDataVersion(prev => prev + 1)
      })
      .catch((err) => {
        console.error('Error loading COPC files:', err)
        setError(err.message || 'Failed to load COPC files')
        setLoading(false)
      })
  }, [files, pointSize, onGlobalDataRangeUpdate, onDataRangeUpdate])

  // Rebuild point clouds when height filter changes
  useEffect(() => {
    if (!globeRef.current || dataRef.current.length === 0 || viewMode === '2d') return

    const scene = globeRef.current.getScene()
    if (!scene) return

    // Remove existing point clouds
    pointCloudsRef.current.forEach(pc => {
      scene.remove(pc)
      pc.geometry.dispose()
      if (pc.material instanceof THREE.Material) {
        pc.material.dispose()
      }
    })
    pointCloudsRef.current = []

    // Recreate point clouds with filtered data
    let totalPoints = 0
    dataRef.current.forEach((data, dataIndex) => {
      // Apply height filter
      const filteredData = filterPointsByHeight(data)

      // Use current camera distance for decimation
      const camera = globeRef.current.getCamera()
      const distance = camera ? camera.position.length() : 3.0
      const decimation = getDecimationForDistance(distance)
      const decimatedPositions: number[] = []
      const decimatedColors: number[] = []

      for (let i = 0; i < filteredData.positions.length; i += 3) {
        if ((i / 3) % decimation === 0) {
          decimatedPositions.push(
            filteredData.positions[i],
            filteredData.positions[i + 1],
            filteredData.positions[i + 2]
          )
          decimatedColors.push(
            filteredData.colors[i],
            filteredData.colors[i + 1],
            filteredData.colors[i + 2]
          )
        }
      }

      console.log(`[PointCloudViewer] Height filter rebuild: ${data.positions.length / 3} points → (height filter) → ${filteredData.positions.length / 3} points → (decimation 1:${decimation}) → ${decimatedPositions.length / 3} points at distance ${distance.toFixed(2)}`)

      // Convert to globe coordinates
      const decimatedPositionsArray = new Float32Array(decimatedPositions)

      // Store decimated positions for satellite animation (first dataset only)
      if (dataIndex === 0) {
        displayedPositionsRef.current = decimatedPositionsArray
      }

      const globePositions = convertPointsToGlobe(decimatedPositionsArray)

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(decimatedColors), 3, true))

      const material = new THREE.PointsMaterial({
        size: pointSize * 0.002,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
      })

      const points = new THREE.Points(geometry, material)
      scene.add(points)
      pointCloudsRef.current.push(points)

      totalPoints += decimatedPositions.length / 3
    })

    setStats(prev => ({ ...prev, points: totalPoints }))

    // Update lastCameraDistanceRef to reflect the distance at which LOD was rebuilt
    const camera = globeRef.current.getCamera()
    if (camera) {
      lastCameraDistanceRef.current = camera.position.length()
      console.log(`[PointCloudViewer] Height filter change: Updated lastCameraDistanceRef to ${lastCameraDistanceRef.current.toFixed(2)}`)
    }

    // Compute filtered ranges for display and coloring
    computeFilteredRanges()

    // Increment dataVersion to trigger DeckGLMapView update
    setDataVersion(prev => prev + 1)
  }, [heightFilter, filterPointsByHeight, pointSize, viewMode, computeFilteredRanges, getDecimationForDistance, dataLoaded])

  // Update colors when color mode or colormap changes
  useEffect(() => {
    if (!globalRanges.elevation || !globalRanges.intensity) return

    // Check if colors actually changed (not just viewMode)
    const colorSettingsChanged = !lastColorSettingsRef.current ||
      lastColorSettingsRef.current.colorMode !== colorMode ||
      lastColorSettingsRef.current.colormap !== colormap

    // Check if we just switched TO 3D view from 2D
    const switchedTo3D = lastViewModeRef.current === '2d' && viewMode !== '2d'

    // Update the refs
    lastColorSettingsRef.current = { colorMode, colormap }
    lastViewModeRef.current = viewMode

    if (viewMode === '2d') {
      // For 2D view, just update the data and increment dataVersion
      // The 2D map will pick up the new colors from dataRef.current

      // Use filtered ranges if height filter is enabled, otherwise use global ranges
      const activeRanges = (heightFilter?.enabled && filteredRanges.elevation && filteredRanges.intensity)
        ? filteredRanges
        : globalRanges

      console.log('[PointCloudViewer] Updating colors for 2D view, colorMode:', colorMode, 'using ranges:', activeRanges)

      dataRef.current.forEach((data, index) => {
        const colors = data.colors

        switch (colorMode) {
          case 'elevation':
            computeElevationColors(
              data.positions,
              colors,
              activeRanges.elevation![0],
              activeRanges.elevation![1],
              colormap
            )
            break
          case 'intensity':
            computeIntensityColors(
              data.intensities,
              colors,
              activeRanges.intensity![0],
              activeRanges.intensity![1],
              colormap,
              true  // Enable CALIPSO scaling
            )
            break
          case 'classification':
            computeClassificationColors(data.classifications, colors)
            break
        }

        console.log(`[PointCloudViewer] Updated colors for dataset ${index}, sample:`, [colors[0], colors[1], colors[2]])
      })

      // Increment dataVersion to notify DeckGLMapView that colors have changed
      setDataVersion(prev => prev + 1)
    } else if (colorSettingsChanged || switchedTo3D) {
      // For 3D view, use fast color-only update if:
      // 1. Colors actually changed, OR
      // 2. We just switched to 3D view (to ensure colors are applied)
      const reason = switchedTo3D ? 'switched to 3D view' : 'color/colormap changed'
      console.log(`[PointCloudViewer] ${reason} in 3D view - fast color update`)
      updateColors3D()
    }
  }, [colorMode, colormap, globalRanges, filteredRanges, heightFilter, filterPointsByHeight, viewMode, updateColors3D])

  // Update point size for globe view (2D handled by DeckGLMapView props)
  useEffect(() => {
    if (viewMode !== '2d') {
      pointCloudsRef.current.forEach((pc) => {
        if (pc.material instanceof THREE.PointsMaterial) {
          pc.material.size = pointSize * 0.002
          pc.material.needsUpdate = true
        }
      })
    }
  }, [pointSize, viewMode])

  // Set drawing mode on GlobeViewer or DeckGLMapView
  useEffect(() => {
    if (viewMode !== '2d' && globeRef.current && isDrawingAOI !== undefined) {
      globeRef.current.setDrawingMode(isDrawingAOI)
    }
    if (viewMode === '2d' && deckMapRef.current && isDrawingAOI !== undefined) {
      deckMapRef.current.setDrawingMode(isDrawingAOI)
    }
  }, [isDrawingAOI, viewMode])

  // Clear polygon visualization when aoiPolygon is cleared
  useEffect(() => {
    if (viewMode !== '2d' && globeRef.current && aoiPolygon === null) {
      globeRef.current.clearPolygon()
    }
    if (viewMode === '2d' && deckMapRef.current && aoiPolygon === null) {
      deckMapRef.current.clearPolygon()
    }
  }, [aoiPolygon, viewMode])

  // Handle polygon complete callback
  const handlePolygonComplete = useCallback((polygon: LatLon[]) => {
    onPolygonUpdate?.(polygon)
  }, [onPolygonUpdate])

  // Handle animation progress callback for progressive point cloud rendering
  const handleAnimationProgress = useCallback((progress: number) => {
    setAnimationProgress(progress)
  }, [])

  // Handle current GPS time callback during animation
  const handleCurrentGpsTime = useCallback((gpsTime: number) => {
    onCurrentGpsTimeUpdate?.(gpsTime)
  }, [onCurrentGpsTimeUpdate])

  // Handle current position callback during animation
  const handleCurrentPosition = useCallback((lat: number, lon: number) => {
    onCurrentPositionUpdate?.(lat, lon)
  }, [onCurrentPositionUpdate])

  // Filter data when AOI polygon changes or height filter changes
  useEffect(() => {
    if (!aoiPolygon || aoiPolygon.length < 3) {
      setAoiData(null)
      onAOIDataReady?.(false, 0)
      return
    }

    // Filter all loaded data by the polygon and height filter
    let allAltitudes: number[] = []
    let allIntensities: number[] = []

    dataRef.current.forEach(data => {
      // First apply height filter if enabled
      const heightFilteredData = filterPointsByHeight(data)

      // Then apply AOI polygon filter to the height-filtered data
      const filtered = filterDataByAOI(heightFilteredData.positions, heightFilteredData.intensities, aoiPolygon)
      allAltitudes = [...allAltitudes, ...filtered.altitudes]
      allIntensities = [...allIntensities, ...filtered.intensities]
    })

    const hasData = allAltitudes.length > 0
    const pointCount = allAltitudes.length
    setAoiData(hasData ? { altitudes: allAltitudes, intensities: allIntensities } : null)
    onAOIDataReady?.(hasData, pointCount)
  }, [aoiPolygon, onAOIDataReady, heightFilter, filterPointsByHeight])

  // Show scatter plot when triggered from parent
  useEffect(() => {
    if (showScatterPlotTrigger && aoiData) {
      setShowScatterPlot(true)
    }
  }, [showScatterPlotTrigger, aoiData])

  // Handle view mode changes
  useEffect(() => {
    console.log(`[PointCloudViewer] View mode change effect triggered, viewMode = "${viewMode}", globeRef.current = ${!!globeRef.current}`)

    // Handle switching TO 2D: Use continuously-tracked 3D camera state
    if (viewMode === '2d') {
      console.log('[PointCloudViewer] Detected switch TO 2D, using tracked 3D camera state...')
      const cameraState = last3DCameraStateRef.current
      console.log('[PointCloudViewer] last3DCameraStateRef contains:', cameraState)

      if (cameraState && cameraState.distance && cameraState.target) {
        console.log(`[PointCloudViewer] Using tracked 3D camera state for 2D: distance ${cameraState.distance.toFixed(2)}, target (${cameraState.target.lon.toFixed(2)}, ${cameraState.target.lat.toFixed(2)})`)

        // Convert 3D camera distance to 2D zoom level
        const distanceToZoom = (distance: number): number => {
          return Math.max(1, Math.min(18, 10 - Math.log2(distance) * 3))
        }

        const { distance, target } = cameraState
        const zoom = distanceToZoom(distance)
        const center: [number, number] = [target.lon, target.lat]

        console.log(`[PointCloudViewer] Before state update: mapCenter = (${mapCenter[0].toFixed(4)}, ${mapCenter[1].toFixed(4)}), mapZoom = ${mapZoom.toFixed(4)}`)

        // Update state immediately so DeckGLMapView renders with correct values
        setMapCenter(center)
        setMapZoom(zoom)
        setMapViewKey(prev => prev + 1) // Force DeckGLMapView remount with fresh props
        last2DMapStateRef.current = { center, zoom }

        console.log(`[PointCloudViewer] 3D→2D: distance ${distance.toFixed(4)} → zoom ${zoom.toFixed(4)}, center (${center[0].toFixed(4)}, ${center[1].toFixed(4)})`)
      } else {
        console.warn('[PointCloudViewer] No valid tracked 3D camera state available, using current mapCenter/mapZoom')
        // Keep current map center/zoom if no 3D camera state
        setMapViewKey(prev => prev + 1) // Still force remount to ensure clean state
      }
    }

    // Handle switching TO 3D: Capture 2D map state if available
    if (viewMode !== '2d' && deckMapRef.current) {
      const mapState = deckMapRef.current.getMapState()
      if (mapState) {
        last2DMapStateRef.current = { center: mapState.center, zoom: mapState.zoom }
        console.log(`[PointCloudViewer] Captured 2D map state before switching to 3D: center (${mapState.center[0].toFixed(2)}, ${mapState.center[1].toFixed(2)}), zoom ${mapState.zoom.toFixed(1)}`)
      }
    }

    // Update GlobeViewer if it exists
    if (globeRef.current) {
      globeRef.current.setViewMode(viewMode)

      // Force LOD update when switching to 3D mode
      if (viewMode !== '2d') {
        lastCameraDistanceRef.current = -1
        console.log('[PointCloudViewer] Switching to 3D mode - forcing LOD update')

        setTimeout(() => {
          updateGlobeLOD()
        }, 100)
      }
    }
  }, [viewMode, updateGlobeLOD])


  // Transform point cloud coordinates for globe/ground views and ensure they're in the scene
  useEffect(() => {
    if (viewMode === '2d' || dataRef.current.length === 0) return

    const scene = globeRef.current?.getScene()
    if (!scene) return

    dataRef.current.forEach((data, index) => {
      const pointCloud = pointCloudsRef.current[index]
      if (!pointCloud) return

      // Re-add point cloud to scene if it's not there (happens when switching from 2D back to globe)
      if (!scene.children.includes(pointCloud)) {
        scene.add(pointCloud)
      }

      // Apply height filter
      const filteredData = filterPointsByHeight(data)

      // Convert coordinates to globe view
      const positions = convertPointsToGlobe(filteredData.positions)

      // Update the geometry
      const positionAttribute = pointCloud.geometry.getAttribute('position') as THREE.BufferAttribute
      positionAttribute.array = positions
      positionAttribute.needsUpdate = true
    })
  }, [viewMode, filterPointsByHeight])

  // Notify parent when first point is loaded
  useEffect(() => {
    onFirstPointUpdate?.(firstPoint)
  }, [firstPoint, onFirstPointUpdate])

  // Notify parent when last point is loaded
  useEffect(() => {
    onLastPointUpdate?.(lastPoint)
  }, [lastPoint, onLastPointUpdate])

  // Trigger satellite animation when requested (triggers on every change, regardless of value)
  useEffect(() => {
    if (onAnimateSatelliteTrigger !== undefined && onAnimateSatelliteTrigger > 0 && globeRef.current && firstPoint && lastPoint) {
      // Use the currently displayed decimated positions for satellite animation
      // This ensures the satellite moves in sync with the visible point cloud
      const positions = displayedPositionsRef.current
      if (!positions) {
        console.warn('[PointCloudViewer] No decimated positions available for satellite animation')
      }
      globeRef.current.animateSatelliteToFirstPoint(firstPoint, lastPoint, positions || undefined)
    }
  }, [onAnimateSatelliteTrigger, firstPoint, lastPoint])

  // Progressive point cloud rendering based on animation progress
  useEffect(() => {
    if (viewMode === '2d') return // Only apply in globe view

    pointCloudsRef.current.forEach((pointCloud, index) => {
      if (!pointCloud.geometry) return

      // Use the actual count of points in the displayed geometry (after decimation)
      const positionAttribute = pointCloud.geometry.getAttribute('position')
      if (!positionAttribute) return

      const totalPoints = positionAttribute.count

      // Calculate how many points to show based on animation progress
      // Progress 0 = show 0 points, Progress 1 = show all points
      const visiblePointCount = Math.floor(totalPoints * animationProgress)

      // Use THREE.js drawRange to only render the first N points
      // This creates the curtain effect as satellite moves
      pointCloud.geometry.setDrawRange(0, visiblePointCount)

      if (index === 0 && animationProgress > 0 && animationProgress < 1) {
        console.log(`[PointCloudViewer] Animation progress: ${(animationProgress * 100).toFixed(1)}%, showing ${visiblePointCount}/${totalPoints} decimated points`)
      }
    })
  }, [animationProgress, viewMode])

  // Update ref with current 2D map state when it changes
  useEffect(() => {
    if (viewMode !== '2d' || !deckMapRef.current) return

    const updateMapState = () => {
      if (deckMapRef.current) {
        const mapState = deckMapRef.current.getMapState()
        if (mapState) {
          last2DMapStateRef.current = { center: mapState.center, zoom: mapState.zoom }
        }
      }
    }

    // Update immediately
    updateMapState()

    // Listen for map move events
    const map = deckMapRef.current.getMap()
    if (map) {
      map.on('moveend', updateMapState)
      map.on('zoomend', updateMapState)

      return () => {
        map.off('moveend', updateMapState)
        map.off('zoomend', updateMapState)
      }
    }
  }, [viewMode])

  // Calculate initial camera state for 3D view based on 2D map position
  const initialCameraState = useMemo(() => {
    // Only calculate if we're in 3D mode
    if (viewMode === '2d') return undefined

    // Helper function to convert 2D zoom level to 3D camera distance
    const zoomToDistance = (zoom: number): number => {
      return Math.pow(2, (10 - zoom) / 3)
    }

    // Try to get from ref first (captured before switching)
    let center: [number, number] = mapCenter
    let zoom: number = mapZoom

    if (last2DMapStateRef.current) {
      center = last2DMapStateRef.current.center
      zoom = last2DMapStateRef.current.zoom
      console.log(`[PointCloudViewer] Using captured 2D map state from ref: center (${center[0].toFixed(4)}, ${center[1].toFixed(4)}), zoom ${zoom.toFixed(4)}`)
    } else {
      console.log(`[PointCloudViewer] Using current map state values: center (${center[0].toFixed(4)}, ${center[1].toFixed(4)}), zoom ${zoom.toFixed(4)}`)
    }

    const distance = zoomToDistance(zoom)
    const target = { lon: center[0], lat: center[1] }

    console.log(`[PointCloudViewer] 2D→3D: zoom ${zoom.toFixed(4)} → distance ${distance.toFixed(4)}, target (${target.lon.toFixed(4)}, ${target.lat.toFixed(4)})`)

    // IMPORTANT: Update the tracked 3D camera ref so it's available for the next switch to 2D
    last3DCameraStateRef.current = { distance, target }
    console.log(`[PointCloudViewer] Updated last3DCameraStateRef for future 2D switches`)

    return { distance, target }
  }, [viewMode, mapCenter, mapZoom])

  return (
    <div className="point-cloud-viewer">
      {viewMode === '2d' ? (
        <DeckGLMapView
          key={mapViewKey}
          ref={deckMapRef}
          center={mapCenter}
          zoom={mapZoom}
          data={filteredDataForMap}
          colorMode={colorMode}
          colormap={colormap}
          pointSize={pointSize}
          dataVersion={dataVersion}
          isDrawingAOI={isDrawingAOI}
          aoiPolygon={aoiPolygon}
          onPolygonComplete={handlePolygonComplete}
        />
      ) : (
        <GlobeViewer
          ref={globeRef}
          onPolygonComplete={handlePolygonComplete}
          onAnimationProgress={handleAnimationProgress}
          onCurrentGpsTime={handleCurrentGpsTime}
          onCurrentPosition={handleCurrentPosition}
          initialCameraState={initialCameraState}
        />
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">
            Loading COPC files... {Math.round(loadingProgress)}%
          </div>
        </div>
      )}

      {error && (
        <div className="error-overlay">
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="stats-overlay">
          {stats.points.toLocaleString()} points • {stats.files} file{stats.files !== 1 ? 's' : ''}
        </div>
      )}

      {showScatterPlot && aoiData && (
        <AOIScatterPlot
          altitudes={aoiData.altitudes}
          intensities={aoiData.intensities}
          pointCount={aoiData.altitudes.length}
          onClose={() => setShowScatterPlot(false)}
        />
      )}
    </div>
  )
}
