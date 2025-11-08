import { useState, useEffect, useCallback } from 'react'
import PointCloudViewer from './components/PointCloudViewer'
import FileSelector from './components/FileSelector'
import ControlPanel from './components/ControlPanel'
import ControlsInfo from './components/ControlsInfo'
import DataInfo from './components/DataInfo'
import { Colormap } from './utils/colormaps'
import { LatLon } from './utils/aoiSelector'
import './App.css'

export type ColorMode = 'elevation' | 'intensity' | 'classification'
export type FileMode = 'single' | 'tiled'
export type ViewMode = 'space' | '2d'
export type { Colormap }

// Available COPC files - served from public/output (symlinked)
const SINGLE_FILES = [
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.copc.laz',
  '/output/CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.copc.laz'
]

const TILED_FILES = [
  '/output/tiled/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_south.copc.laz'
]

export interface DataRange {
  elevation: [number, number] | null
  intensity: [number, number] | null
}

export interface HeightFilter {
  enabled: boolean
  min: number
  max: number
}

function App() {
  const [fileMode, setFileMode] = useState<FileMode>('tiled')
  const [selectedFiles, setSelectedFiles] = useState<string[]>(fileMode === 'single' ? [SINGLE_FILES[0]] : TILED_FILES)
  const [colorMode, setColorMode] = useState<ColorMode>('intensity')
  const [colormap, setColormap] = useState<Colormap>('plasma')
  const [pointSize, setPointSize] = useState(2.0)
  const [viewMode, setViewMode] = useState<ViewMode>('space')

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

  const handleFileModeChange = (mode: FileMode) => {
    setFileMode(mode)
    // Update selected files based on mode
    if (mode === 'single') {
      setSelectedFiles([SINGLE_FILES[0]])
    } else {
      setSelectedFiles(TILED_FILES)
    }
  }

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

  const handleViewModeChange = (mode: ViewMode) => {
    // Clear AOI selection when switching between views
    if (mode !== viewMode) {
      console.log(`[App] Switching view mode from ${viewMode} to ${mode}, clearing AOI`)
      handleClearAOI()

      // Set colormap to jet and point size to 10 when switching to 2D mode
      if (mode === '2d') {
        console.log(`[App] Switching to 2D mode, setting colormap to jet and point size to 10`)
        setColormap('jet')
        setPointSize(10)
      }
    }
    setViewMode(mode)
  }

  const handleHeightFilterChange = (updates: Partial<HeightFilter>) => {
    setHeightFilter(prev => ({ ...prev, ...updates }))
  }

  const handleResetHeightFilter = () => {
    setHeightFilter(prev => ({
      ...prev,
      min: globalDataRange.elevation ? globalDataRange.elevation[0] : 0,
      max: globalDataRange.elevation ? globalDataRange.elevation[1] : 40
    }))
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

  const handleExitGroundMode = () => {
    setIsGroundModeActive(false)
    setGroundCameraPosition(null)
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
        isGroundModeActive={isGroundModeActive}
        groundCameraPosition={groundCameraPosition}
        onGroundCameraPositionSet={handleGroundCameraPositionSet}
      />

      <FileSelector
        fileMode={fileMode}
        onFileModeChange={handleFileModeChange}
        singleFiles={SINGLE_FILES}
        tiledFiles={TILED_FILES}
        selectedFiles={selectedFiles}
        onSelectionChange={setSelectedFiles}
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
        globalDataRange={globalDataRange}
        heightFilter={heightFilter}
        onHeightFilterChange={handleHeightFilterChange}
        onResetHeightFilter={handleResetHeightFilter}
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
