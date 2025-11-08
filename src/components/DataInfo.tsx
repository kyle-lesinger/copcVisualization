import { DataRange } from '../App'
import './DataInfo.css'

interface DataInfoProps {
  dataRange: DataRange
}

export default function DataInfo({ dataRange }: DataInfoProps) {
  return (
    <div className="data-info-panel">
      <div className="data-info-section">
        <h4>Data Info:</h4>
        <p>
          <strong>Source:</strong> CALIPSO Level 1<br />
          <strong>Date:</strong> 2023-06-30<br />
          <strong>Format:</strong> COPC (LAZ 1.4)
        </p>
      </div>

      <div className="data-range-section">
        <h4>Data Ranges:</h4>
        {dataRange.elevation && (
          <p>
            <strong>Elevation:</strong><br />
            {dataRange.elevation[0].toFixed(2)} to {dataRange.elevation[1].toFixed(2)} km
          </p>
        )}
        {dataRange.intensity && (
          <p>
            <strong>Intensity (532nm):</strong><br />
            {dataRange.intensity[0].toFixed(3)} to {dataRange.intensity[1].toFixed(3)} km⁻¹·sr⁻¹
          </p>
        )}
        {!dataRange.elevation && !dataRange.intensity && (
          <p className="text-muted">Loading data...</p>
        )}
      </div>
    </div>
  )
}
