import { useState } from 'react'
import PointCloudViewer from './components/PointCloudViewer'
import FileSelector from './components/FileSelector'
import ControlPanel from './components/ControlPanel'
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

function App() {
  const [fileMode, setFileMode] = useState<FileMode>('tiled')
  const [selectedFiles, setSelectedFiles] = useState<string[]>(fileMode === 'single' ? [SINGLE_FILES[0]] : TILED_FILES)
  const [colorMode, setColorMode] = useState<ColorMode>('intensity')
  const [colormap, setColormap] = useState<Colormap>('plasma')
  const [pointSize, setPointSize] = useState(2.0)
  const [viewMode, setViewMode] = useState<ViewMode>('space')
  const [dataRange, setDataRange] = useState<DataRange>({
    elevation: null,
    intensity: null
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
  const [animateSatelliteTrigger, setAnimateSatelliteTrigger] = useState(false)

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
    setAnimateSatelliteTrigger(prev => !prev)
  }

  const handleCurrentGpsTimeUpdate = (gpsTime: number | null) => {
    console.log('App: Updating currentGpsTime to:', gpsTime)
    setCurrentGpsTime(gpsTime)
  }

  const handleCurrentPositionUpdate = (lat: number, lon: number) => {
    setCurrentPosition({ lat, lon })
  }

  return (
    <div className="app">
      <PointCloudViewer
        files={selectedFiles}
        colorMode={colorMode}
        colormap={colormap}
        pointSize={pointSize}
        viewMode={viewMode}
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
        onViewModeChange={setViewMode}
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
      />
    </div>
  )
}

export default App
