import { useState, useEffect } from 'react'
import './DateRangeFilter.css'

interface DateRangeFilterProps {
  startDate: string // ISO datetime string YYYY-MM-DDTHH:mm:ss
  endDate: string
  onApply: (startDate: string, endDate: string) => void
  onReset: () => void
  enabled: boolean
  onToggleEnabled: () => void
}

export default function DateRangeFilter({
  startDate,
  endDate,
  onApply,
  onReset,
  enabled,
  onToggleEnabled
}: DateRangeFilterProps) {
  const [startInput, setStartInput] = useState(startDate)
  const [endInput, setEndInput] = useState(endDate)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    setStartInput(startDate)
    setEndInput(endDate)
  }, [startDate, endDate])

  const handleApply = () => {
    // Validation
    if (!startInput || !endInput) {
      setValidationError('Both start and end dates are required')
      return
    }

    const start = new Date(startInput)
    const end = new Date(endInput)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setValidationError('Invalid date format')
      return
    }

    if (start > end) {
      setValidationError('Start date must be before or equal to end date')
      return
    }

    setValidationError(null)

    // Log filter application
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[DateRangeFilter] 📅 DATE RANGE FILTER APPLIED')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`[DateRangeFilter] 🕐 User selected datetime range:`)
    console.log(`  • Start: ${start.toLocaleString()}`)
    console.log(`  • End:   ${end.toLocaleString()}`)
    console.log(`[DateRangeFilter] 📂 This will be used to search for CALIPSO files matching:`)
    console.log(`  CAL_LID_L1-Standard-V4-51.{date-time-range}*.copc.laz`)
    console.log(`[DateRangeFilter] ⚡ Async file search will find matching files based on this range`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    onApply(startInput, endInput)
  }

  const handleReset = () => {
    onReset()
    setValidationError(null)
  }

  return (
    <div className="date-range-section">
      <div className="date-range-header">
        <h4>Date Range</h4>
        <label className="date-range-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
          />
          <span className="toggle-label">{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      <div className={`date-range-controls ${!enabled ? 'disabled' : ''}`}>
        <div className="date-input-row">
          <div className="date-input-group">
            <label className="control-label">Start Date & Time</label>
            <input
              type="datetime-local"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="date-input"
              disabled={!enabled}
              step="1"
            />
          </div>

          <div className="date-input-group">
            <label className="control-label">End Date & Time</label>
            <input
              type="datetime-local"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              className="date-input"
              disabled={!enabled}
              step="1"
            />
          </div>
        </div>

        {validationError && (
          <div className="validation-error">
            {validationError}
          </div>
        )}

        <div className="date-range-summary">
          <div className="range-text">
            <strong>Active Range:</strong><br/>
            {new Date(startDate).toLocaleString()} to<br/>{new Date(endDate).toLocaleString()}
          </div>
        </div>

        <div className="date-range-buttons">
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
