import { ColorMode, Colormap, DataRange, ViewMode, HeightFilter } from '../App'
import { getColormapName } from '../utils/colormaps'
import { formatTaiTime } from '../utils/copcLoader'
import HeightFilterPanel from './HeightFilterPanel'
import ColorBar from './ColorBar'
import './ControlPanel.css'

interface ControlPanelProps {
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void
  colormap: Colormap
  onColormapChange: (colormap: Colormap) => void
  pointSize: number
  onPointSizeChange: (size: number) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  dataRange: DataRange
  globalDataRange: DataRange
  // Height filter controls
  heightFilter: HeightFilter
  onHeightFilterChange: (updates: Partial<HeightFilter>) => void
  onResetHeightFilter: () => void
  // AOI controls
  isDrawingAOI: boolean
  onToggleDrawAOI: () => void
  onClearAOI: () => void
  onShowScatterPlot: () => void
  hasAOI: boolean
  hasAOIData: boolean
  aoiPointCount?: number
  // Satellite animation controls
  firstPoint?: { lon: number, lat: number, alt: number, gpsTime: number } | null
  lastPoint?: { lon: number, lat: number, alt: number, gpsTime: number } | null
  currentGpsTime?: number | null
  currentPosition?: { lat: number, lon: number } | null
  onAnimateSatellite?: () => void
  // Ground mode controls
  isGroundModeActive: boolean
  onToggleGroundMode: () => void
  groundCameraPosition: { lat: number, lon: number } | null
}

export default function ControlPanel({
  colorMode,
  onColorModeChange,
  colormap,
  onColormapChange,
  pointSize,
  onPointSizeChange,
  viewMode,
  onViewModeChange,
  dataRange,
  globalDataRange,
  heightFilter,
  onHeightFilterChange,
  onResetHeightFilter,
  isDrawingAOI,
  onToggleDrawAOI,
  onClearAOI,
  onShowScatterPlot,
  hasAOI,
  hasAOIData,
  aoiPointCount,
  firstPoint,
  lastPoint,
  currentGpsTime,
  currentPosition,
  onAnimateSatellite,
  isGroundModeActive,
  onToggleGroundMode,
  groundCameraPosition
}: ControlPanelProps) {
  const colormaps: Colormap[] = ['viridis', 'plasma', 'turbo', 'coolwarm', 'jet', 'grayscale']

  return (
    <div className="panel control-panel">
      <h3>Display Settings</h3>

      <div className="control-group">
        <label className="control-label">Color Mode</label>
        <select
          value={colorMode}
          onChange={(e) => onColorModeChange(e.target.value as ColorMode)}
          className="control-select"
        >
          <option value="elevation">Elevation (Altitude)</option>
          <option value="intensity">Intensity (Backscatter 532nm)</option>
        </select>
      </div>

      {(
        <>
          <div className="control-group">
            <label className="control-label">Colormap</label>
            <select
              value={colormap}
              onChange={(e) => onColormapChange(e.target.value as Colormap)}
              className="control-select"
            >
              {colormaps.map(cm => (
                <option key={cm} value={cm}>{getColormapName(cm)}</option>
              ))}
            </select>
          </div>

          {/* ColorBar showing the current data range */}
          {(() => {
            // Determine which data range to display based on color mode and height filter
            let minValue = 0
            let maxValue = 1
            let label = ''

            if (colorMode === 'elevation') {
              // For elevation, use height filter if enabled, otherwise use data range
              if (heightFilter.enabled) {
                minValue = heightFilter.min
                maxValue = heightFilter.max
                label = 'Altitude (km, filtered)'
              } else if (dataRange.elevation) {
                minValue = dataRange.elevation[0]
                maxValue = dataRange.elevation[1]
                label = 'Altitude (km)'
              }
            } else if (colorMode === 'intensity') {
              if (dataRange.intensity) {
                minValue = dataRange.intensity[0]
                maxValue = dataRange.intensity[1]
                label = 'Backscatter Intensity (532nm)'
              }
            }

            // Only show colorbar if we have valid data
            const hasValidRange = maxValue > minValue

            return hasValidRange ? (
              <ColorBar
                colormap={colormap}
                minValue={minValue}
                maxValue={maxValue}
                label={label}
              />
            ) : null
          })()}
        </>
      )}

      <div className="control-group">
        <label className="control-label">
          Point Size: {pointSize.toFixed(1)}
        </label>
        <input
          type="range"
          min="0.5"
          max="10"
          step="0.5"
          value={pointSize}
          onChange={(e) => onPointSizeChange(parseFloat(e.target.value))}
          className="control-slider"
        />
      </div>

      <HeightFilterPanel
        minHeight={heightFilter.min}
        maxHeight={heightFilter.max}
        absoluteMin={globalDataRange.elevation ? globalDataRange.elevation[0] : 0}
        absoluteMax={globalDataRange.elevation ? globalDataRange.elevation[1] : 40}
        onApply={(min, max) => onHeightFilterChange({ min, max })}
        onReset={onResetHeightFilter}
        enabled={heightFilter.enabled}
        onToggleEnabled={() => onHeightFilterChange({ enabled: !heightFilter.enabled })}
      />

      <div className="control-group">
        <label className="control-label">View Mode</label>
        <button
          className="control-button view-toggle"
          onClick={() => {
            const nextMode = viewMode === 'space' ? '2d' : 'space'
            onViewModeChange(nextMode)
          }}
        >
          {viewMode === 'space' ? '🗺️ 2D Map' : '🌍 Space View'}
        </button>
      </div>

      {/* Ground Mode is only available in 2D view */}
      {viewMode === '2d' && (
        <div className="control-group">
          <label className="control-label">Ground View</label>
          <button
            className={`control-button ${isGroundModeActive ? 'active' : ''}`}
            onClick={onToggleGroundMode}
          >
            {isGroundModeActive ? '✓ Ground Mode Active' : '🏔️ Activate Ground Mode'}
          </button>
          {isGroundModeActive && !groundCameraPosition && (
            <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
              Click on globe/map to place camera
            </p>
          )}
          {isGroundModeActive && groundCameraPosition && (
            <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
              Camera at {Math.abs(groundCameraPosition.lat).toFixed(4)}°{groundCameraPosition.lat < 0 ? 'S' : 'N'}, {Math.abs(groundCameraPosition.lon).toFixed(4)}°{groundCameraPosition.lon > 0 ? 'E' : 'W'}
            </p>
          )}
        </div>
      )}

      <div className="aoi-controls">
        <h4>Area of Interest:</h4>
        <div className="control-group">
          <button
            className={`control-button ${isDrawingAOI ? 'active' : ''}`}
            onClick={onToggleDrawAOI}
          >
            {isDrawingAOI ? 'Finish AOI' : 'Select AOI'}
          </button>
          {hasAOI && (
            <button
              className="control-button"
              onClick={onClearAOI}
            >
              Clear AOI
            </button>
          )}
        </div>
        {hasAOIData && aoiPointCount !== undefined && (
          <div className="aoi-info">
            <p><strong>Points in AOI:</strong> {aoiPointCount.toLocaleString()}</p>
            <button
              className="control-button primary"
              onClick={onShowScatterPlot}
            >
              Plot
            </button>
          </div>
        )}
        {isDrawingAOI && (
          <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
            Click on globe to add vertices
          </p>
        )}
      </div>

      <div className="satellite-controls">
        <h4>Satellite Animation:</h4>
        {firstPoint && lastPoint ? (
          <>
            <div className="satellite-info">
              <p><strong>Time:</strong> {(() => {
                const displayTime = currentGpsTime !== null && currentGpsTime !== undefined ? currentGpsTime : firstPoint.gpsTime

                // Check if GPS time is valid (TAI seconds should be positive and reasonable)
                if (displayTime > 0 && displayTime < 1e10) {
                  return formatTaiTime(displayTime)
                } else {
                  // Fallback for invalid or index-based times
                  return `Point ${Math.floor(displayTime)}`
                }
              })()}</p>
              <p><strong>Time Range:</strong><br/>
                <small>
                  {firstPoint.gpsTime > 0 && firstPoint.gpsTime < 1e10
                    ? formatTaiTime(firstPoint.gpsTime).split(' ').slice(1).join(' ')
                    : `Point ${Math.floor(firstPoint.gpsTime)}`}
                  {' → '}
                  {lastPoint.gpsTime > 0 && lastPoint.gpsTime < 1e10
                    ? formatTaiTime(lastPoint.gpsTime).split(' ').slice(1).join(' ')
                    : `Point ${Math.floor(lastPoint.gpsTime)}`}
                </small>
              </p>
              <p><strong>Position:</strong> {(() => {
                const displayLat = currentPosition?.lat ?? firstPoint.lat
                const displayLon = currentPosition?.lon ?? firstPoint.lon
                const latDir = displayLat < 0 ? 'S' : 'N'
                const lonDir = displayLon > 0 ? 'E' : 'W'
                return `${Math.abs(displayLat).toFixed(4)}°${latDir}, ${Math.abs(displayLon).toFixed(4)}°${lonDir}`
              })()}</p>
            </div>
            <button
              className="control-button primary"
              onClick={onAnimateSatellite}
            >
              Animate Satellite Path
            </button>
          </>
        ) : (
          <p className="text-muted">Loading data...</p>
        )}
      </div>
    </div>
  )
}
