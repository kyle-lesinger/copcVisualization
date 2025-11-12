import { useState, useEffect } from 'react'
import './TimeRangePanel.css'

interface TimeRangePanelProps {
  minGpsTime: number
  maxGpsTime: number
  absoluteBounds: {
    minGpsTime: number
    maxGpsTime: number
  } | null
  onApply: (minGpsTime: number, maxGpsTime: number) => void
  onReset: () => void
  enabled: boolean
  onToggleEnabled: () => void
}

// Convert GPS time (TAI93 - seconds since 1993-01-01) to UTC Date
function gpsTimeToDate(gpsTime: number): Date {
  // GPS time epoch: 1993-01-01 00:00:00 UTC
  const gpsEpoch = new Date('1993-01-01T00:00:00Z').getTime()
  // Convert GPS seconds to milliseconds and add to epoch
  return new Date(gpsEpoch + gpsTime * 1000)
}

// Convert UTC Date to GPS time (TAI93)
function dateToGpsTime(date: Date): number {
  const gpsEpoch = new Date('1993-01-01T00:00:00Z').getTime()
  return (date.getTime() - gpsEpoch) / 1000
}

// Format GPS time as readable string
function formatGpsTime(gpsTime: number): string {
  const date = gpsTimeToDate(gpsTime)
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
}

export default function TimeRangePanel({
  minGpsTime,
  maxGpsTime,
  absoluteBounds,
  onApply,
  onReset,
  enabled,
  onToggleEnabled
}: TimeRangePanelProps) {

  // Local state for input values
  const [minInput, setMinInput] = useState(minGpsTime.toString())
  const [maxInput, setMaxInput] = useState(maxGpsTime.toString())
  const [validationError, setValidationError] = useState<string | null>(null)

  // Update local state when prop values change (e.g., from reset)
  useEffect(() => {
    setMinInput(minGpsTime.toString())
    setMaxInput(maxGpsTime.toString())
  }, [minGpsTime, maxGpsTime])

  const handleApply = () => {
    const min = parseFloat(minInput)
    const max = parseFloat(maxInput)

    // Validation
    if (isNaN(min) || isNaN(max)) {
      setValidationError('Please enter valid numbers')
      return
    }

    if (absoluteBounds) {
      if (min < absoluteBounds.minGpsTime || min > absoluteBounds.maxGpsTime) {
        setValidationError(`Minimum must be between ${absoluteBounds.minGpsTime.toFixed(0)} and ${absoluteBounds.maxGpsTime.toFixed(0)}`)
        return
      }

      if (max < absoluteBounds.minGpsTime || max > absoluteBounds.maxGpsTime) {
        setValidationError(`Maximum must be between ${absoluteBounds.minGpsTime.toFixed(0)} and ${absoluteBounds.maxGpsTime.toFixed(0)}`)
        return
      }
    }

    if (min > max) {
      setValidationError('Minimum must be less than or equal to maximum')
      return
    }

    // Clear error and apply filter
    setValidationError(null)
    onApply(min, max)
  }

  const handleReset = () => {
    onReset()
    if (absoluteBounds) {
      setMinInput(absoluteBounds.minGpsTime.toString())
      setMaxInput(absoluteBounds.maxGpsTime.toString())
    }
    setValidationError(null)
  }

  return (
    <div className="time-range-section">
      <div className="time-range-header">
        <h4>GPS Time Range Filter</h4>
        <label className="time-range-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
          />
          <span className="toggle-label">{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      <div className={`time-range-controls ${!enabled ? 'disabled' : ''}`}>
        <div className="time-input-row">
          <div className="time-input-group">
            <label className="control-label">Minimum (TAI93 seconds)</label>
            <input
              type="number"
              step="1"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              className="time-input"
              disabled={!enabled}
              placeholder={absoluteBounds ? absoluteBounds.minGpsTime.toFixed(0) : '0'}
            />
            <div className="time-hint">
              {!isNaN(parseFloat(minInput)) && formatGpsTime(parseFloat(minInput))}
            </div>
          </div>

          <div className="time-input-group">
            <label className="control-label">Maximum (TAI93 seconds)</label>
            <input
              type="number"
              step="1"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              className="time-input"
              disabled={!enabled}
              placeholder={absoluteBounds ? absoluteBounds.maxGpsTime.toFixed(0) : '0'}
            />
            <div className="time-hint">
              {!isNaN(parseFloat(maxInput)) && formatGpsTime(parseFloat(maxInput))}
            </div>
          </div>
        </div>

        {validationError && (
          <div className="validation-error">
            {validationError}
          </div>
        )}

        <div className="time-range-summary">
          <div className="range-text">
            <strong>Active Range:</strong><br/>
            {formatGpsTime(minGpsTime)}<br/>
            to {formatGpsTime(maxGpsTime)}
          </div>
        </div>

        {absoluteBounds && (
          <div className="time-range-info">
            <div className="info-text">
              <strong>Data Range:</strong><br/>
              {formatGpsTime(absoluteBounds.minGpsTime)}<br/>
              to {formatGpsTime(absoluteBounds.maxGpsTime)}
            </div>
          </div>
        )}

        <div className="time-range-buttons">
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

export { gpsTimeToDate, dateToGpsTime, formatGpsTime }
