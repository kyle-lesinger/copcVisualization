import { useState, useEffect, useCallback } from 'react'
import PointCloudViewer from './components/PointCloudViewer'
import FilterPanel from './components/FilterPanel'
import ControlPanel from './components/ControlPanel'
import ControlsInfo from './components/ControlsInfo'
import DataInfo from './components/DataInfo'
import { Colormap } from './utils/colormaps'
import { LatLon } from './utils/aoiSelector'
import { searchCalipsoFiles, FileSearchResult, getAvailableFileList } from './utils/fileSearch'
import './App.css'

export type ColorMode = 'elevation' | 'intensity' | 'classification'
export type ViewMode = 'space' | '2d'
export type { Colormap }

export interface DataRange {
  elevation: [number, number] | null
  intensity: [number, number] | null
}

export interface HeightFilter {
  enabled: boolean
  min: number
  max: number
}

export interface SpatialBoundsFilter {
  enabled: boolean
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
  minAlt: number
  maxAlt: number
}

export interface DateRangeFilter {
  enabled: boolean
  startDate: string // ISO datetime string YYYY-MM-DDTHH:mm:ss
  endDate: string
}

export type BandType = 'all' | 'day' | 'night'

function App() {
  // File management
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [foundFiles, setFoundFiles] = useState<FileSearchResult | null>(null)
  const [spatialFilterApplyCounter, setSpatialFilterApplyCounter] = useState(0)

  const [colorMode, setColorMode] = useState<ColorMode>('intensity')
  const [colormap, setColormap] = useState<Colormap>('plasma')
  const [pointSize, setPointSize] = useState(2.0)
  const [viewMode] = useState<ViewMode>('2d') // Fixed to 2D mode only

  // Global data range - never changes, represents full unfiltered data
  const [globalDataRange, setGlobalDataRange] = useState<DataRange>({
    elevation: null,
    intensity: null
  })

  // Current data range - may be filtered
  const [dataRange, setDataRange] = useState<DataRange>({
    elevation: null,
    intensity: null
  })

  // Height filter state
  const [heightFilter, setHeightFilter] = useState<HeightFilter>({
    enabled: false,
    min: 0,
    max: 40
  })

  // Spatial bounds filter state
  const [spatialBoundsFilter, setSpatialBoundsFilter] = useState<SpatialBoundsFilter>({
    enabled: false,
    minLon: -180,
    maxLon: 180,
    minLat: -90,
    maxLat: 90,
    minAlt: 0,
    maxAlt: 40
  })

  // Date range filter state
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>({
    enabled: false,
    startDate: '2023-06-30T16:00:00',
    endDate: '2023-06-30T17:00:00'
  })

  // Band type filter state
  const [selectedBand, setSelectedBand] = useState<BandType>('all')

  // AOI state
  const [aoiPolygon, setAoiPolygon] = useState<LatLon[] | null>(null)
  const [isDrawingAOI, setIsDrawingAOI] = useState(false)
  const [hasAOIData, setHasAOIData] = useState(false)
  const [aoiPointCount, setAoiPointCount] = useState<number>(0)
  const [showScatterPlotTrigger, setShowScatterPlotTrigger] = useState(false)

  // Satellite animation state
  const [firstPoint, setFirstPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [lastPoint, setLastPoint] = useState<{ lon: number, lat: number, alt: number, gpsTime: number } | null>(null)
  const [currentGpsTime, setCurrentGpsTime] = useState<number | null>(null)
  const [currentPosition, setCurrentPosition] = useState<{ lat: number, lon: number } | null>(null)
  const [animateSatelliteTrigger, setAnimateSatelliteTrigger] = useState(0)

  // Track if height filter has been initialized to prevent overwriting user changes
  const [heightFilterInitialized, setHeightFilterInitialized] = useState(false)

  // Ground mode state
  const [isGroundModeActive, setIsGroundModeActive] = useState(false)
  const [groundCameraPosition, setGroundCameraPosition] = useState<{ lat: number, lon: number } | null>(null)

  const handleToggleDrawAOI = () => {
    setIsDrawingAOI(!isDrawingAOI)
    if (isDrawingAOI) {
      // Finish drawing
      // The polygon will be stored by the GlobeViewer
    }
  }

  const handleClearAOI = () => {
    setAoiPolygon(null)
    setHasAOIData(false)
    setAoiPointCount(0)
    setIsDrawingAOI(false)
  }

  const handleShowScatterPlot = () => {
    setShowScatterPlotTrigger(prev => !prev)
  }

  const handleAOIDataReady = (hasData: boolean, pointCount?: number) => {
    setHasAOIData(hasData)
    setAoiPointCount(pointCount || 0)
  }

  const handlePolygonUpdate = (polygon: LatLon[]) => {
    setAoiPolygon(polygon)
  }

  const handleAnimateSatellite = () => {
    setAnimateSatelliteTrigger(prev => prev + 1)
  }

  const handleCurrentGpsTimeUpdate = (gpsTime: number | null) => {
    setCurrentGpsTime(gpsTime)
  }

  const handleCurrentPositionUpdate = (lat: number, lon: number) => {
    setCurrentPosition({ lat, lon })
  }

  // View mode is fixed to 2D - removed toggle functionality
  const handleViewModeChange = (mode: ViewMode) => {
    // No-op: View mode is fixed to 2D
    console.log('[App] View mode is fixed to 2D mode only')
  }

  const handleSpatialBoundsFilterChange = (updates: Partial<SpatialBoundsFilter>) => {
    setSpatialBoundsFilter(prev => {
      const newFilter = { ...prev, ...updates }

      // Log when filter is enabled/disabled
      if ('enabled' in updates && updates.enabled !== prev.enabled) {
        if (updates.enabled) {
          console.log('[App] ✅ Spatial bounds filter ENABLED (toggle ON)')
          console.log('[App] ℹ️  Data will NOT load until you click "Apply Filter" button')
          // Do NOT increment counter here - only on Apply Filter button
        } else {
          console.log('[App] ❌ Spatial bounds filter DISABLED')
        }
      }

      // If filter values changed (Apply Filter button clicked), increment counter
      // This happens when user clicks "Apply Filter" in the spatial bounds panel
      const valuesChanged = ('minLon' in updates || 'maxLon' in updates ||
                            'minLat' in updates || 'maxLat' in updates ||
                            'minAlt' in updates || 'maxAlt' in updates)

      if (valuesChanged && newFilter.enabled) {
        console.log('[App] 🔄 Spatial bounds "Apply Filter" button clicked')
        // Increment apply counter to trigger reload with new bounds
        setSpatialFilterApplyCounter(c => c + 1)
      }

      return newFilter
    })
  }

  const handleResetSpatialBoundsFilter = () => {
    setSpatialBoundsFilter(prev => ({
      ...prev,
      minLon: globalDataRange.elevation ? -180 : -180,
      maxLon: globalDataRange.elevation ? 180 : 180,
      minLat: globalDataRange.elevation ? -90 : -90,
      maxLat: globalDataRange.elevation ? 90 : 90,
      minAlt: globalDataRange.elevation ? globalDataRange.elevation[0] : 0,
      maxAlt: globalDataRange.elevation ? globalDataRange.elevation[1] : 40
    }))
  }

  const handleDateRangeFilterChange = (updates: Partial<DateRangeFilter>) => {
    setDateRangeFilter(prev => {
      const newFilter = { ...prev, ...updates }

      // Log when filter is enabled/disabled
      if ('enabled' in updates && updates.enabled !== prev.enabled) {
        if (updates.enabled) {
          console.log('[App] ✅ Date range filter ENABLED')
          console.log(`[App] 📅 Date range: ${prev.startDate} to ${prev.endDate}`)
        } else {
          console.log('[App] ❌ Date range filter DISABLED')
        }
      }

      return newFilter
    })
  }

  const handleResetDateRangeFilter = () => {
    setDateRangeFilter({
      enabled: false,
      startDate: '2023-06-30T16:00:00',
      endDate: '2023-06-30T17:00:00'
    })
  }

  const handleBandChange = (band: BandType) => {
    console.log(`[App] 🔄 Band type changed to: ${band}`)
    if (dateRangeFilter.enabled) {
      console.log(`[App] 🔍 Will search for files matching band "${band}" and date range`)
      console.log(`[App] 📅 Date range: ${dateRangeFilter.startDate} to ${dateRangeFilter.endDate}`)
    }
    setSelectedBand(band)
  }

  const handleToggleGroundMode = () => {
    setIsGroundModeActive(prev => !prev)
    // Reset ground camera position when deactivating
    if (isGroundModeActive) {
      setGroundCameraPosition(null)
    }
  }

  const handleGroundCameraPositionSet = (lat: number, lon: number) => {
    setGroundCameraPosition({ lat, lon })
  }

  const handleGlobalDataRangeUpdate = useCallback((range: DataRange) => {
    // Set both global range (for validation) and current range (for display)
    setGlobalDataRange(range)
    setDataRange(range)
  }, [])

  // Update height filter range when data loads (only on initial load)
  useEffect(() => {
    if (globalDataRange.elevation && !heightFilterInitialized) {
      setHeightFilter(prev => ({
        ...prev,
        min: globalDataRange.elevation![0],
        max: globalDataRange.elevation![1]
      }))
      setHeightFilterInitialized(true)
    }
  }, [globalDataRange.elevation, heightFilterInitialized])

  // Automatic file search when date range or band type changes
  useEffect(() => {
    // Only search if date range filter is enabled
    if (!dateRangeFilter.enabled) {
      console.log('[App] ℹ️  Date range filter disabled - skipping file search')
      setFoundFiles(null)
      setSelectedFiles([])
      return
    }

    // Perform async file search
    const performSearch = async () => {
      console.log('[App] 🔍 Triggering automatic file search...')
      console.log(`[App] Band: ${selectedBand}, Date range: ${dateRangeFilter.startDate} to ${dateRangeFilter.endDate}`)

      try {
        // Search for files using the file search utility
        // Uses the configured file list from fileSearch.ts
        // In production, replace with API endpoint or S3 listing
        const result = await searchCalipsoFiles(
          selectedBand,
          dateRangeFilter.startDate,
          dateRangeFilter.endDate,
          {
            fileList: getAvailableFileList() // Update file list in fileSearch.ts
          }
        )

        setFoundFiles(result)

        // Automatically select found files (they will be loaded when spatial filter is applied)
        if (result.files.length > 0) {
          console.log(`[App] ✅ ${result.files.length} files ready for loading`)
          console.log(`[App] 📋 Files stored and ready for spatial filtering`)
          // Don't load files yet - wait for spatial bounds to be applied
        }

      } catch (error) {
        console.error('[App] ❌ File search failed:', error)
        setFoundFiles(null)
      }
    }

    performSearch()
  }, [selectedBand, dateRangeFilter.enabled, dateRangeFilter.startDate, dateRangeFilter.endDate])

  // Load files ONLY when spatial bounds filter is explicitly applied (counter increments)
  // Clear files when spatial bounds filter is disabled
  useEffect(() => {
    // If spatial bounds filter is disabled, clear files
    if (!spatialBoundsFilter.enabled) {
      if (selectedFiles.length > 0) {
        console.log('[App] 🗑️  Spatial bounds filter disabled - clearing data')
        setSelectedFiles([])
      }
      return
    }

    // Only proceed if counter > 0 (meaning filter was explicitly applied)
    if (spatialFilterApplyCounter === 0) {
      return
    }

    // If enabled, check if we have files to load
    if (!foundFiles || foundFiles.files.length === 0) {
      console.log('[App] ⚠️  Spatial bounds filter applied but no files found to load')
      setSelectedFiles([])
      return
    }

    // Clear old data and load new files with spatial filtering
    console.log('[App] 🔄 Spatial bounds filter APPLIED - loading data')
    console.log('[App] 🗑️  Clearing old data first')
    console.log('[App] 🗺️  Loading files with spatial bounds:')
    console.log(`  • Lon: ${spatialBoundsFilter.minLon.toFixed(2)}° to ${spatialBoundsFilter.maxLon.toFixed(2)}°`)
    console.log(`  • Lat: ${spatialBoundsFilter.minLat.toFixed(2)}° to ${spatialBoundsFilter.maxLat.toFixed(2)}°`)
    console.log(`  • Alt: ${spatialBoundsFilter.minAlt.toFixed(2)} to ${spatialBoundsFilter.maxAlt.toFixed(2)} km`)
    console.log(`[App] 📂 Loading ${foundFiles.files.length} file(s)`)

    // Create a new array reference to force React to recognize the change
    // This ensures PointCloudViewer reloads even if the file list is the same
    setSelectedFiles([...foundFiles.files])

  }, [spatialFilterApplyCounter, spatialBoundsFilter.enabled, foundFiles, selectedFiles.length, spatialBoundsFilter.minLon, spatialBoundsFilter.maxLon, spatialBoundsFilter.minLat, spatialBoundsFilter.maxLat, spatialBoundsFilter.minAlt, spatialBoundsFilter.maxAlt])

  return (
    <div className="app">
      <PointCloudViewer
        files={selectedFiles}
        colorMode={colorMode}
        colormap={colormap}
        pointSize={pointSize}
        viewMode={viewMode}
        onGlobalDataRangeUpdate={handleGlobalDataRangeUpdate}
        onDataRangeUpdate={setDataRange}
        aoiPolygon={aoiPolygon}
        showScatterPlotTrigger={showScatterPlotTrigger}
        onAOIDataReady={handleAOIDataReady}
        onPolygonUpdate={handlePolygonUpdate}
        isDrawingAOI={isDrawingAOI}
        onAnimateSatelliteTrigger={animateSatelliteTrigger}
        onFirstPointUpdate={setFirstPoint}
        onLastPointUpdate={setLastPoint}
        onCurrentGpsTimeUpdate={handleCurrentGpsTimeUpdate}
        onCurrentPositionUpdate={handleCurrentPositionUpdate}
        heightFilter={heightFilter}
        spatialBoundsFilter={spatialBoundsFilter}
        isGroundModeActive={isGroundModeActive}
        groundCameraPosition={groundCameraPosition}
        onGroundCameraPositionSet={handleGroundCameraPositionSet}
      />

      <FilterPanel
        selectedBand={selectedBand}
        onBandChange={handleBandChange}
        dateRangeFilter={dateRangeFilter}
        onDateRangeFilterChange={handleDateRangeFilterChange}
        onResetDateRangeFilter={handleResetDateRangeFilter}
        spatialBoundsFilter={spatialBoundsFilter}
        onSpatialBoundsFilterChange={handleSpatialBoundsFilterChange}
        onResetSpatialBoundsFilter={handleResetSpatialBoundsFilter}
        globalDataRange={globalDataRange}
      />

      <ControlPanel
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        colormap={colormap}
        onColormapChange={setColormap}
        pointSize={pointSize}
        onPointSizeChange={setPointSize}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        dataRange={dataRange}
        isDrawingAOI={isDrawingAOI}
        onToggleDrawAOI={handleToggleDrawAOI}
        onClearAOI={handleClearAOI}
        onShowScatterPlot={handleShowScatterPlot}
        hasAOI={aoiPolygon !== null && aoiPolygon.length >= 3}
        hasAOIData={hasAOIData}
        aoiPointCount={aoiPointCount}
        firstPoint={firstPoint}
        lastPoint={lastPoint}
        currentGpsTime={currentGpsTime}
        currentPosition={currentPosition}
        onAnimateSatellite={handleAnimateSatellite}
        isGroundModeActive={isGroundModeActive}
        onToggleGroundMode={handleToggleGroundMode}
        groundCameraPosition={groundCameraPosition}
      />

      <DataInfo dataRange={dataRange} />

      <ControlsInfo />
    </div>
  )
}

export default App
