import { useState, useEffect } from 'react'
import './SpatialBoundsPanel.css'

interface SpatialBoundsPanelProps {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
  minAlt: number
  maxAlt: number
  absoluteBounds: {
    minLon: number
    maxLon: number
    minLat: number
    maxLat: number
    minAlt: number
    maxAlt: number
  } | null
  onApply: (bounds: {
    minLon: number
    maxLon: number
    minLat: number
    maxLat: number
    minAlt: number
    maxAlt: number
  }) => void
  onReset: () => void
  enabled: boolean
  onToggleEnabled: () => void
}

export default function SpatialBoundsPanel({
  minLon,
  maxLon,
  minLat,
  maxLat,
  minAlt,
  maxAlt,
  absoluteBounds,
  onApply,
  onReset,
  enabled,
  onToggleEnabled
}: SpatialBoundsPanelProps) {

  // Local state for input values
  const [minLonInput, setMinLonInput] = useState(minLon.toString())
  const [maxLonInput, setMaxLonInput] = useState(maxLon.toString())
  const [minLatInput, setMinLatInput] = useState(minLat.toString())
  const [maxLatInput, setMaxLatInput] = useState(maxLat.toString())
  const [minAltInput, setMinAltInput] = useState(minAlt.toString())
  const [maxAltInput, setMaxAltInput] = useState(maxAlt.toString())
  const [validationError, setValidationError] = useState<string | null>(null)

  // Update local state when prop values change (e.g., from reset)
  useEffect(() => {
    setMinLonInput(minLon.toString())
    setMaxLonInput(maxLon.toString())
    setMinLatInput(minLat.toString())
    setMaxLatInput(maxLat.toString())
    setMinAltInput(minAlt.toString())
    setMaxAltInput(maxAlt.toString())
  }, [minLon, maxLon, minLat, maxLat, minAlt, maxAlt])

  const handleApply = () => {
    const minLonVal = parseFloat(minLonInput)
    const maxLonVal = parseFloat(maxLonInput)
    const minLatVal = parseFloat(minLatInput)
    const maxLatVal = parseFloat(maxLatInput)
    const minAltVal = parseFloat(minAltInput)
    const maxAltVal = parseFloat(maxAltInput)

    // Validation
    if (isNaN(minLonVal) || isNaN(maxLonVal) || isNaN(minLatVal) ||
        isNaN(maxLatVal) || isNaN(minAltVal) || isNaN(maxAltVal)) {
      setValidationError('Please enter valid numbers for all fields')
      return
    }

    // Validate geographic limits (not data bounds - user can filter anywhere!)
    if (minLonVal < -180 || minLonVal > 180) {
      setValidationError('Min Longitude must be between -180° and 180°')
      return
    }

    if (maxLonVal < -180 || maxLonVal > 180) {
      setValidationError('Max Longitude must be between -180° and 180°')
      return
    }

    if (minLatVal < -90 || minLatVal > 90) {
      setValidationError('Min Latitude must be between -90° and 90°')
      return
    }

    if (maxLatVal < -90 || maxLatVal > 90) {
      setValidationError('Max Latitude must be between -90° and 90°')
      return
    }

    if (minAltVal < 0 || minAltVal > 100) {
      setValidationError('Min Altitude must be between 0 and 100 km')
      return
    }

    if (maxAltVal < 0 || maxAltVal > 100) {
      setValidationError('Max Altitude must be between 0 and 100 km')
      return
    }

    // Validate min <= max
    if (minLonVal > maxLonVal) {
      setValidationError('Min Longitude must be less than or equal to Max Longitude')
      return
    }

    if (minLatVal > maxLatVal) {
      setValidationError('Min Latitude must be less than or equal to Max Latitude')
      return
    }

    if (minAltVal > maxAltVal) {
      setValidationError('Min Altitude must be less than or equal to Max Altitude')
      return
    }

    // Clear error and apply filter
    setValidationError(null)

    // Log filter application
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[SpatialBoundsPanel] 🗺️  SPATIAL BOUNDS FILTER APPLIED')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`[SpatialBoundsPanel] 📍 User defined spatial bounds:`)
    console.log(`  • Longitude: ${minLonVal.toFixed(2)}° to ${maxLonVal.toFixed(2)}°`)
    console.log(`  • Latitude:  ${minLatVal.toFixed(2)}° to ${maxLatVal.toFixed(2)}°`)
    console.log(`  • Altitude:  ${minAltVal.toFixed(2)} to ${maxAltVal.toFixed(2)} km`)

    // Calculate bounding box volume
    const lonRange = maxLonVal - minLonVal
    const latRange = maxLatVal - minLatVal
    const altRange = maxAltVal - minAltVal
    console.log(`[SpatialBoundsPanel] 📦 Bounding box size:`)
    console.log(`  • ${lonRange.toFixed(2)}° (lon) × ${latRange.toFixed(2)}° (lat) × ${altRange.toFixed(2)} km (alt)`)

    console.log(`[SpatialBoundsPanel] ⚡ COPC octree will now:`)
    console.log(`  1. Skip entire octree nodes outside these bounds`)
    console.log(`  2. Filter individual points within loaded nodes`)
    console.log(`  3. Use HTTP Range requests to fetch ONLY relevant data`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    onApply({
      minLon: minLonVal,
      maxLon: maxLonVal,
      minLat: minLatVal,
      maxLat: maxLatVal,
      minAlt: minAltVal,
      maxAlt: maxAltVal
    })
  }

  const handleReset = () => {
    onReset()
    if (absoluteBounds) {
      setMinLonInput(absoluteBounds.minLon.toString())
      setMaxLonInput(absoluteBounds.maxLon.toString())
      setMinLatInput(absoluteBounds.minLat.toString())
      setMaxLatInput(absoluteBounds.maxLat.toString())
      setMinAltInput(absoluteBounds.minAlt.toString())
      setMaxAltInput(absoluteBounds.maxAlt.toString())
    }
    setValidationError(null)
  }

  return (
    <div className="spatial-bounds-section">
      <div className="spatial-bounds-header">
        <h4>Spatial Bounds Filter</h4>
        <label className="spatial-bounds-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
          />
          <span className="toggle-label">{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      <div className={`spatial-bounds-controls ${!enabled ? 'disabled' : ''}`}>
        {/* Longitude Range */}
        <div className="spatial-input-section">
          <label className="section-label">Longitude (°)</label>
          <div className="spatial-input-row">
            <div className="spatial-input-group">
              <label className="control-label">Min</label>
              <input
                type="number"
                step="0.01"
                value={minLonInput}
                onChange={(e) => setMinLonInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.minLon.toFixed(2) : '0'}
              />
            </div>

            <div className="spatial-input-group">
              <label className="control-label">Max</label>
              <input
                type="number"
                step="0.01"
                value={maxLonInput}
                onChange={(e) => setMaxLonInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.maxLon.toFixed(2) : '0'}
              />
            </div>
          </div>
        </div>

        {/* Latitude Range */}
        <div className="spatial-input-section">
          <label className="section-label">Latitude (°)</label>
          <div className="spatial-input-row">
            <div className="spatial-input-group">
              <label className="control-label">Min</label>
              <input
                type="number"
                step="0.01"
                value={minLatInput}
                onChange={(e) => setMinLatInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.minLat.toFixed(2) : '0'}
              />
            </div>

            <div className="spatial-input-group">
              <label className="control-label">Max</label>
              <input
                type="number"
                step="0.01"
                value={maxLatInput}
                onChange={(e) => setMaxLatInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.maxLat.toFixed(2) : '0'}
              />
            </div>
          </div>
        </div>

        {/* Altitude Range */}
        <div className="spatial-input-section">
          <label className="section-label">Altitude (km)</label>
          <div className="spatial-input-row">
            <div className="spatial-input-group">
              <label className="control-label">Min</label>
              <input
                type="number"
                step="0.1"
                value={minAltInput}
                onChange={(e) => setMinAltInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.minAlt.toFixed(1) : '0'}
              />
            </div>

            <div className="spatial-input-group">
              <label className="control-label">Max</label>
              <input
                type="number"
                step="0.1"
                value={maxAltInput}
                onChange={(e) => setMaxAltInput(e.target.value)}
                className="spatial-input"
                disabled={!enabled}
                placeholder={absoluteBounds ? absoluteBounds.maxAlt.toFixed(1) : '0'}
              />
            </div>
          </div>
        </div>

        {validationError && (
          <div className="validation-error">
            {validationError}
          </div>
        )}

        <div className="spatial-bounds-summary">
          <div className="range-text">
            <strong>Active Range:</strong><br/>
            Lon: {minLon.toFixed(2)}° to {maxLon.toFixed(2)}°<br/>
            Lat: {minLat.toFixed(2)}° to {maxLat.toFixed(2)}°<br/>
            Alt: {minAlt.toFixed(1)} to {maxAlt.toFixed(1)} km
          </div>
        </div>

        <div className="spatial-bounds-buttons">
          <button
            className="control-button primary"
            onClick={handleApply}
            disabled={!enabled}
          >
            Apply Filter
          </button>
          <button
            className="control-button"
            onClick={handleReset}
            disabled={!enabled}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}
