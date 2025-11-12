# Day/Night Band Filter & Date Range Implementation

## Summary

Implemented a comprehensive filter system for CALIPSO data with Day/Night band selection and datetime range filtering. Also reorganized UI layout to prevent overlaps.

## Changes Made

### 1. New Day/Night Band Filter

**Created:** `src/components/DayNightBandFilter.tsx` & `.css`

- Dropdown selector with 3 options:
  - "All Bands" - Search both D and N files
  - "Day Band (D)" - Only files ending in 'D'
  - "Night Band (N)" - Only files ending in 'N'
- Based on CALIPSO filename convention: `CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz`
  - `ZD` = Day band
  - `ZN` = Night band

### 2. New Date Range Filter (Replaces GPS Time)

**Created:** `src/components/DateRangeFilter.tsx` & `.css`

- Uses `datetime-local` input type for full date + time selection (HH:MM:SS)
- Start Date & Time input
- End Date & Time input
- Displays active range in human-readable format
- Enable/disable toggle
- Apply/Reset buttons
- Validation for date ranges

**Removed:**
- `TimeRangePanel.tsx` (old GPS time filter)
- GPS time inputs that only showed TAI93 seconds

### 3. Filter Reordering

**New order in FilterPanel:**
1. Day/Night Band (dropdown)
2. Date Range (datetime picker)
3. Spatial Bounds (lon/lat/alt ranges)

**Removed:**
- Height Filter (no longer in FilterPanel)

### 4. UI Layout Changes

**Moved to bottom-right:**
- `DataInfo` panel (was bottom-left)
- `ControlsInfo` panel (was bottom-left)

**Changes:**
- `src/components/DataInfo.css`: `left: 20px` → `right: 20px`
- `src/components/ControlsInfo.css`: `left: 20px` → `right: 20px`

**Result:** No overlap with Data Filters panel (top-left)

### 5. State Management Updates

**In App.tsx:**

Added new state:
```typescript
// Date range filter
const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>({
  enabled: false,
  startDate: '2023-06-01T00:00:00',
  endDate: '2023-06-30T23:59:59'
})

// Band type filter
const [selectedBand, setSelectedBand] = useState<BandType>('all')
```

New handlers:
- `handleDateRangeFilterChange()`
- `handleResetDateRangeFilter()`
- `handleBandChange()`

Removed:
- `timeRangeFilter` state
- `handleTimeRangeFilterChange()`
- `handleResetTimeRangeFilter()`

### 6. Type Updates

**New types exported from App.tsx:**
```typescript
export interface DateRangeFilter {
  enabled: boolean
  startDate: string // ISO datetime string YYYY-MM-DDTHH:mm:ss
  endDate: string
}

export type BandType = 'all' | 'day' | 'night'
```

**Removed:**
```typescript
export interface TimeRangeFilter // No longer needed
```

## File Structure

```
src/
├── components/
│   ├── DayNightBandFilter.tsx         [NEW]
│   ├── DayNightBandFilter.css         [NEW]
│   ├── DateRangeFilter.tsx            [NEW]
│   ├── DateRangeFilter.css            [NEW]
│   ├── FilterPanel.tsx                [UPDATED - reordered filters]
│   ├── DataInfo.css                   [UPDATED - moved to right]
│   ├── ControlsInfo.css               [UPDATED - moved to right]
│   └── PointCloudViewer.tsx           [UPDATED - removed timeRangeFilter]
└── App.tsx                            [UPDATED - new state & handlers]
```

**Deleted:**
- `TimeRangePanel.tsx`
- `TimeRangePanel.css`

## How to Use

### 1. Select Band Type
- Open top-left "Data Filters" panel
- Select from dropdown:
  - **All Bands**: Search will include both day and night files
  - **Day Band (D)**: Only files ending in 'D' will be searched
  - **Night Band (N)**: Only files ending in 'N' will be searched

### 2. Set Date & Time Range
- Toggle "Date Range" to ON
- Click "Start Date & Time" input
  - Select date from calendar
  - Set time using HH:MM:SS picker
- Click "End Date & Time" input
  - Select date from calendar
  - Set time using HH:MM:SS picker
- Click "Apply Filter"

### 3. Set Spatial Bounds (Optional)
- Toggle "Spatial Bounds Filter" to ON
- Enter longitude range (degrees)
- Enter latitude range (degrees)
- Enter altitude range (km)
- Click "Apply Filter"

### 4. File Search (Async - To Be Implemented)

**Next step:** Add async file search function that:
1. Monitors band type + date range selection
2. Constructs search pattern: `CAL_LID_L1-Standard-V4-51.{date}*Z{D|N}.copc.laz`
3. Searches for matching files while user fills other filters
4. Loads found files when user clicks "Load Data" or similar trigger

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│                     Visualization                        │
│                                                          │
│  ┌────────────────┐                  ┌──────────────┐  │
│  │ Data Filters   │                  │ Control      │  │
│  │ (Top Left)     │                  │ Panel        │  │
│  │                │                  │ (Top Right)  │  │
│  │ • Day/Night    │                  │              │  │
│  │ • Date Range   │                  │              │  │
│  │ • Spatial      │                  │              │  │
│  │   Bounds       │                  │              │  │
│  └────────────────┘                  └──────────────┘  │
│                                                          │
│                                      ┌──────────────┐  │
│                                      │ DataInfo     │  │
│                                      │ (Bottom R)   │  │
│                                      ├──────────────┤  │
│                                      │ ControlsInfo │  │
│                                      │ (Bottom R)   │  │
│                                      └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Datetime Format

### Input Format
- HTML5 `datetime-local` type
- Format: `YYYY-MM-DDTHH:mm:ss`
- Example: `2023-06-30T16:44:43`

### Display Format
- Uses JavaScript `toLocaleString()`
- Example: `6/30/2023, 4:44:43 PM` (locale-dependent)

### Storage Format
- Stored as ISO 8601 string
- Example: `2023-06-30T16:44:43`

## Filename Pattern Matching

### CALIPSO Filename Structure
```
CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz
│                     └───────┬───────┘└┬┘
│                          Date & Time  │
│                                    Band Type
│                                    D = Day
│                                    N = Night
```

### Search Pattern Examples

**All bands, specific date:**
```
CAL_LID_L1-Standard-V4-51.2023-06-30*Z{D|N}.copc.laz
```

**Day only, date range:**
```
CAL_LID_L1-Standard-V4-51.2023-06-{01..30}*ZD.copc.laz
```

**Night only, specific time:**
```
CAL_LID_L1-Standard-V4-51.2023-06-30T17-*ZN.copc.laz
```

## Next Steps

### 1. Implement Async File Search

Add function to search for files based on filters:

```typescript
async function searchCOPCFiles(
  bandType: BandType,
  startDate: string,
  endDate: string,
  basePath: string
): Promise<string[]> {
  // Convert date range to filename pattern
  // Search filesystem or API for matching files
  // Return array of file paths
}
```

### 2. Add Loading Indicator

Show spinner/progress while searching for files:
```typescript
const [isSearching, setIsSearching] = useState(false)
const [foundFiles, setFoundFiles] = useState<string[]>([])
```

### 3. Add File List Display

Show found files before loading:
```typescript
<div className="found-files">
  <h4>Found {foundFiles.length} files</h4>
  <ul>
    {foundFiles.map(file => <li key={file}>{file}</li>)}
  </ul>
  <button onClick={() => loadFiles(foundFiles)}>Load Files</button>
</div>
```

### 4. Integrate with LOD Manager

When files are loaded, pass filters to COPC LOD manager:
```typescript
lodManager.setSpatialBounds(spatialBoundsFilter)
lodManager.setDateRange(dateRangeFilter)
```

## Testing

1. **Band selection:**
   - Select "Day Band" → Should prepare to search only `*ZD.copc.laz` files
   - Select "Night Band" → Should prepare to search only `*ZN.copc.laz` files
   - Select "All Bands" → Should search both

2. **Date & time selection:**
   - Pick start: June 1, 2023 00:00:00
   - Pick end: June 30, 2023 23:59:59
   - Should filter files within this range

3. **UI layout:**
   - Data Filters panel should be top-left
   - DataInfo should be bottom-right
   - ControlsInfo should be bottom-right
   - No overlaps

4. **Datetime display:**
   - Active range should show full datetime
   - Format should be readable (locale-aware)

## Known Limitations

1. **File search not yet implemented** - Need to add async search function
2. **No file list display** - Need UI to show found files
3. **Height filter removed** - If needed, add back to FilterPanel
4. **Server/filesystem integration needed** - Currently no file discovery mechanism

## Compatibility

- Works with existing spatial bounds filtering
- Compatible with COPC LOD manager
- Ready for S3 integration
- Supports local and remote file sources
