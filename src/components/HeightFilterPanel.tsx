import { useState, useEffect } from 'react'
import './HeightFilterPanel.css'

interface HeightFilterPanelProps {
  minHeight: number
  maxHeight: number
  absoluteMin: number
  absoluteMax: number
  onApply: (min: number, max: number) => void
  onReset: () => void
  enabled: boolean
  onToggleEnabled: () => void
}

export default function HeightFilterPanel({
  minHeight,
  maxHeight,
  absoluteMin,
  absoluteMax,
  onApply,
  onReset,
  enabled,
  onToggleEnabled
}: HeightFilterPanelProps) {

  // Local state for input values
  const [minInput, setMinInput] = useState(minHeight.toString())
  const [maxInput, setMaxInput] = useState(maxHeight.toString())
  const [validationError, setValidationError] = useState<string | null>(null)

  // Update local state when prop values change (e.g., from reset)
  useEffect(() => {
    setMinInput(minHeight.toString())
    setMaxInput(maxHeight.toString())
  }, [minHeight, maxHeight])

  const handleApply = () => {
    const min = parseFloat(minInput)
    const max = parseFloat(maxInput)

    // Validation
    if (isNaN(min) || isNaN(max)) {
      setValidationError('Please enter valid numbers')
      return
    }

    if (min < absoluteMin || min > absoluteMax) {
      setValidationError(`Minimum must be between ${absoluteMin} and ${absoluteMax} km`)
      return
    }

    if (max < absoluteMin || max > absoluteMax) {
      setValidationError(`Maximum must be between ${absoluteMin} and ${absoluteMax} km`)
      return
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
    setMinInput(absoluteMin.toString())
    setMaxInput(absoluteMax.toString())
    setValidationError(null)
  }

  return (
    <div className="height-filter-section">
      <div className="height-filter-header">
        <h4>Height Filter</h4>
        <label className="height-filter-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
          />
          <span className="toggle-label">{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      <div className={`height-filter-controls ${!enabled ? 'disabled' : ''}`}>
        <div className="height-input-row">
          <div className="height-input-group">
            <label className="control-label">Minimum (km)</label>
            <input
              type="number"
              min={absoluteMin}
              max={absoluteMax}
              step="0.1"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              className="height-input"
              disabled={!enabled}
              placeholder={absoluteMin.toFixed(1)}
            />
          </div>

          <div className="height-input-group">
            <label className="control-label">Maximum (km)</label>
            <input
              type="number"
              min={absoluteMin}
              max={absoluteMax}
              step="0.1"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              className="height-input"
              disabled={!enabled}
              placeholder={absoluteMax.toFixed(1)}
            />
          </div>
        </div>

        {validationError && (
          <div className="validation-error">
            {validationError}
          </div>
        )}

        <div className="height-filter-summary">
          <span className="range-text">
            Active: {minHeight.toFixed(1)} - {maxHeight.toFixed(1)} km
          </span>
        </div>

        <div className="height-filter-buttons">
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
