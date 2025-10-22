import { ColorMode, Colormap, DataRange, ViewMode } from '../App'
import { getColormapName } from '../utils/colormaps'
import { formatTaiTime } from '../utils/copcLoader'
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
  onAnimateSatellite
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
          <option value="classification">Classification</option>
        </select>
      </div>

      {colorMode !== 'classification' && (
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

      <div className="control-info">
        <h4>Controls:</h4>
        <ul>
          <li><kbd>Left Mouse</kbd> - Rotate</li>
          <li><kbd>Right Mouse</kbd> - Pan</li>
          <li><kbd>Scroll</kbd> - Zoom</li>
          <li><kbd>R</kbd> - Reset Camera</li>
        </ul>
      </div>

      <div className="data-info">
        <h4>Data Info:</h4>
        <p>
          <strong>Source:</strong> CALIPSO Level 1<br />
          <strong>Date:</strong> 2023-06-30<br />
          <strong>Format:</strong> COPC (LAZ 1.4)
        </p>
      </div>

      <div className="data-range-info">
        <h4>Data Ranges:</h4>
        {dataRange.elevation && (
          <p>
            <strong>Elevation:</strong><br />
            {dataRange.elevation[0].toFixed(2)} to {dataRange.elevation[1].toFixed(2)} km
          </p>
        )}
        {dataRange.intensity && (
          <p>
            <strong>Intensity:</strong><br />
            {dataRange.intensity[0].toFixed(0)} to {dataRange.intensity[1].toFixed(0)}
          </p>
        )}
        {!dataRange.elevation && !dataRange.intensity && (
          <p className="text-muted">Loading data...</p>
        )}
      </div>

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
                console.log('ControlPanel: Displaying GPS time:', displayTime, '(currentGpsTime=', currentGpsTime, ')')

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
              disabled={viewMode === '2d'}
            >
              Animate Satellite Path
            </button>
            {viewMode === '2d' && (
              <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                Switch to Space View to animate satellite
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">Loading data...</p>
        )}
      </div>
    </div>
  )
}
