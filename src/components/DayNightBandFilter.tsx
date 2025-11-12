import './DayNightBandFilter.css'

export type BandType = 'all' | 'day' | 'night'

interface DayNightBandFilterProps {
  selectedBand: BandType
  onBandChange: (band: BandType) => void
}

export default function DayNightBandFilter({
  selectedBand,
  onBandChange
}: DayNightBandFilterProps) {
  const handleBandChange = (newBand: BandType) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[DayNightBandFilter] 🌓 DAY/NIGHT BAND FILTER CHANGED')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`[DayNightBandFilter] 🔄 Band selection changed: ${selectedBand} → ${newBand}`)

    if (newBand === 'all') {
      console.log(`[DayNightBandFilter] 📂 Searching for ALL bands:`)
      console.log(`  • Files ending in 'D' (Day band)`)
      console.log(`  • Files ending in 'N' (Night band)`)
      console.log(`  Pattern: CAL_LID_L1-Standard-V4-51.*Z[DN].copc.laz`)
    } else if (newBand === 'day') {
      console.log(`[DayNightBandFilter] ☀️  Searching for DAY band only:`)
      console.log(`  • Only files ending in 'D'`)
      console.log(`  Pattern: CAL_LID_L1-Standard-V4-51.*ZD.copc.laz`)
    } else if (newBand === 'night') {
      console.log(`[DayNightBandFilter] 🌙 Searching for NIGHT band only:`)
      console.log(`  • Only files ending in 'N'`)
      console.log(`  Pattern: CAL_LID_L1-Standard-V4-51.*ZN.copc.laz`)
    }

    console.log(`[DayNightBandFilter] ⚡ File search will be refined based on this band selection`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    onBandChange(newBand)
  }

  return (
    <div className="band-filter-section">
      <div className="band-filter-header">
        <h4>Day/Night Band</h4>
      </div>

      <div className="band-filter-controls">
        <div className="control-group">
          <label className="control-label">Band Type</label>
          <select
            value={selectedBand}
            onChange={(e) => handleBandChange(e.target.value as BandType)}
            className="band-select"
          >
            <option value="all">All Bands</option>
            <option value="day">Day Band (D)</option>
            <option value="night">Night Band (N)</option>
          </select>
        </div>

        <div className="band-info">
          <div className="info-text">
            {selectedBand === 'all' && (
              <>
                <strong>All bands selected</strong><br/>
                Files ending in 'D' (day) and 'N' (night) will be searched
              </>
            )}
            {selectedBand === 'day' && (
              <>
                <strong>Day band selected</strong><br/>
                Only files ending in 'D' will be searched
              </>
            )}
            {selectedBand === 'night' && (
              <>
                <strong>Night band selected</strong><br/>
                Only files ending in 'N' will be searched
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
