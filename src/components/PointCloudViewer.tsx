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
  onDataRangeUpdate: (range: DataRange) => void
  aoiPolygon: LatLon[] | null
  showScatterPlotTrigger?: boolean
  onAOIDataReady?: (hasData: boolean, pointCount?: number) => void
  onPolygonUpdate?: (polygon: LatLon[]) => void
  isDrawingAOI?: boolean
  onAnimateSatelliteTrigger?: boolean
  onFirstPointUpdate?: (firstPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null) => void
  onLastPointUpdate?: (lastPoint: { lon: number, lat: number, alt: number, gpsTime: number } | null) => void
  onCurrentGpsTimeUpdate?: (gpsTime: number | null) => void
  onCurrentPositionUpdate?: (lat: number, lon: number) => void
  heightFilter?: HeightFilter
}

export default function PointCloudViewer({ files, colorMode, colormap, pointSize, viewMode, onDataRangeUpdate, aoiPolygon, showScatterPlotTrigger, onAOIDataReady, onPolygonUpdate, isDrawingAOI, onAnimateSatelliteTrigger, onFirstPointUpdate, onLastPointUpdate, onCurrentGpsTimeUpdate, onCurrentPositionUpdate, heightFilter }: PointCloudViewerProps) {
  const globeRef = useRef<GlobeViewerHandle>(null)
  const deckMapRef = useRef<DeckGLMapViewHandle>(null)
  const pointCloudsRef = useRef<THREE.Points[]>([])
  const dataRef = useRef<PointCloudData[]>([])

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
  const [dataLoaded, setDataLoaded] = useState(false)
  const [dataVersion, setDataVersion] = useState(0) // Increment to trigger DeckGLMapView update

  // AOI scatter plot state
  const [showScatterPlot, setShowScatterPlot] = useState(false)
  const [aoiData, setAoiData] = useState<{ altitudes: number[], intensities: number[] } | null>(null)

  // First and last point state for satellite animation
  const [firstPoint, setFirstPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [lastPoint, setLastPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [animationProgress, setAnimationProgress] = useState(1) // Start at 1 to show all points initially

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
        onDataRangeUpdate(ranges)

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
        allData.forEach((data) => {
          // Apply height filter before creating geometry
          const filteredData = filterPointsByHeight(data)

          // Convert lat/lon/alt coordinates to 3D globe coordinates
          // Note: LAZ file has X=lon, Y=lat, Z=alt (in km)
          const globePositions = convertPointsToGlobe(filteredData.positions)

          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
          geometry.setAttribute('color', new THREE.BufferAttribute(filteredData.colors, 3, true))

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

          totalPoints += filteredData.count
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
  }, [files, pointSize, onDataRangeUpdate, filterPointsByHeight])

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
    dataRef.current.forEach((data) => {
      // Apply height filter
      const filteredData = filterPointsByHeight(data)

      // Convert to globe coordinates
      const globePositions = convertPointsToGlobe(filteredData.positions)

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(filteredData.colors, 3, true))

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

      totalPoints += filteredData.count
    })

    setStats(prev => ({ ...prev, points: totalPoints }))

    // Compute filtered ranges for display and coloring
    computeFilteredRanges()

    // Increment dataVersion to trigger DeckGLMapView update
    setDataVersion(prev => prev + 1)
  }, [heightFilter, filterPointsByHeight, pointSize, viewMode, computeFilteredRanges])

  // Update colors when color mode or colormap changes
  useEffect(() => {
    if (!globalRanges.elevation || !globalRanges.intensity) return

    // Use filtered ranges if height filter is enabled, otherwise use global ranges
    const activeRanges = (heightFilter?.enabled && filteredRanges.elevation && filteredRanges.intensity)
      ? filteredRanges
      : globalRanges

    dataRef.current.forEach((data, index) => {
      // Apply height filter first
      const filteredData = filterPointsByHeight(data)
      const colors = filteredData.colors

      switch (colorMode) {
        case 'elevation':
          computeElevationColors(
            filteredData.positions,
            colors,
            activeRanges.elevation![0],
            activeRanges.elevation![1],
            colormap
          )
          break
        case 'intensity':
          // Use filtered intensity range for better color mapping
          computeIntensityColors(
            filteredData.intensities,
            colors,
            activeRanges.intensity![0],
            activeRanges.intensity![1],
            colormap,
            true  // Enable CALIPSO scaling
          )
          break
        case 'classification':
          computeClassificationColors(filteredData.classifications, colors)
          break
      }

      // Update the geometry for globe view
      const pointCloud = pointCloudsRef.current[index]
      if (pointCloud) {
        const colorAttribute = pointCloud.geometry.getAttribute('color') as THREE.BufferAttribute
        colorAttribute.array = colors
        colorAttribute.needsUpdate = true
      }
    })

    // Increment dataVersion to notify DeckGLMapView that colors have changed
    setDataVersion(prev => prev + 1)
  }, [colorMode, colormap, globalRanges, filteredRanges, heightFilter, filterPointsByHeight])

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
    console.log('PointCloudViewer: Received GPS time:', gpsTime)
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
    if (globeRef.current) {
      globeRef.current.setViewMode(viewMode)
    }
  }, [viewMode])


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

  // Trigger satellite animation when requested
  useEffect(() => {
    if (onAnimateSatelliteTrigger && globeRef.current && firstPoint && lastPoint) {
      // Pass the positions array from the first dataset so satellite can track actual points
      const positions = dataRef.current.length > 0 ? dataRef.current[0].positions : undefined
      globeRef.current.animateSatelliteToFirstPoint(firstPoint, lastPoint, positions)
    }
  }, [onAnimateSatelliteTrigger, firstPoint, lastPoint])

  // Progressive point cloud rendering based on animation progress
  useEffect(() => {
    if (viewMode === '2d') return // Only apply in globe view

    pointCloudsRef.current.forEach((pointCloud, index) => {
      const data = dataRef.current[index]
      if (!data) return

      const totalPoints = data.count

      // Calculate how many points to show based on animation progress
      // Progress 0 = show 0 points, Progress 1 = show all points
      const visiblePointCount = Math.floor(totalPoints * animationProgress)

      // Use THREE.js drawRange to only render the first N points
      // This creates the curtain effect as satellite moves
      if (pointCloud.geometry) {
        pointCloud.geometry.setDrawRange(0, visiblePointCount)
      }
    })
  }, [animationProgress, viewMode])

  return (
    <div className="point-cloud-viewer">
      {viewMode === '2d' ? (
        <DeckGLMapView
          ref={deckMapRef}
          center={mapCenter}
          zoom={5}
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
