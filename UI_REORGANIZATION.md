# UI Reorganization - Filter Controls Moved to Top Left

## Summary of Changes

This reorganization removes automatic file loading and consolidates all data filtering controls in the top-left panel for better usability.

## Changes Made

### 1. Removed File Selector (Top Left)
**Before:** FileSelector component at top-left allowed selecting and automatically loading COPC files
**After:** Removed - no automatic file loading on startup

**Files Modified:**
- `src/App.tsx`:
  - Removed `FileMode` type
  - Removed `SINGLE_FILES` and `TILED_FILES` constants
  - Removed `fileMode` state
  - Removed `handleFileModeChange()` function
  - Changed `selectedFiles` to empty array (no auto-load)
  - Removed `FileSelector` component import and rendering

### 2. Created New FilterPanel Component (Top Left)
**New component** that consolidates all three filter panels in one location

**Files Created:**
- `src/components/FilterPanel.tsx` - Container for all filter panels
- `src/components/FilterPanel.css` - Styling for top-left positioning

**Contents:**
- HeightFilterPanel (altitude range)
- SpatialBoundsPanel (lon/lat/alt ranges)
- TimeRangePanel (GPS time range)

**Position:** `top: 20px; left: 20px;` (same position as old FileSelector)

### 3. Updated ControlPanel (Top Right)
**Before:** Contained HeightFilterPanel, SpatialBoundsPanel, and TimeRangePanel
**After:** Only contains display settings and AOI controls

**Files Modified:**
- `src/components/ControlPanel.tsx`:
  - Removed imports for HeightFilterPanel, SpatialBoundsPanel, TimeRangePanel
  - Removed filter-related props from interface
  - Removed filter panel JSX from render
  - Kept: ColorMode, Colormap, ColorBar, Point Size, View Mode, Ground Mode, AOI, Satellite Animation

### 4. App.tsx Integration
**Files Modified:**
- `src/App.tsx`:
  - Replaced FileSelector with FilterPanel
  - Removed filter props from ControlPanel
  - Added filter props to FilterPanel

## Current UI Layout

```
┌─────────────────────────────────────────────────────────┐
│                     Visualization                        │
│                                                          │
│  ┌────────────────┐                  ┌──────────────┐  │
│  │ FilterPanel    │                  │ ControlPanel │  │
│  │ (Top Left)     │                  │ (Top Right)  │  │
│  │                │                  │              │  │
│  │ • Height       │                  │ • Color Mode │  │
│  │ • Spatial      │                  │ • Colormap   │  │
│  │ • Time Range   │                  │ • Point Size │  │
│  │                │                  │ • View Mode  │  │
│  │                │                  │ • Ground Mode│  │
│  │                │                  │ • AOI        │  │
│  │                │                  │ • Satellite  │  │
│  └────────────────┘                  └──────────────┘  │
│                                                          │
│                                                          │
│             ┌────────────┐                              │
│             │ DataInfo   │                              │
│             │ (Bottom L) │                              │
│             └────────────┘                              │
└─────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
App
├── PointCloudViewer
│   ├── GlobeViewer (3D view)
│   └── DeckGLMapView (2D view)
├── FilterPanel (NEW - Top Left)
│   ├── HeightFilterPanel
│   ├── SpatialBoundsPanel
│   └── TimeRangePanel
├── ControlPanel (Top Right - simplified)
│   ├── ColorBar
│   └── Display/AOI/Animation controls
├── DataInfo (Bottom Left)
└── ControlsInfo (Info overlay)
```

## How to Load Files Now

Since automatic file loading is disabled, files must be loaded programmatically. There are two approaches:

### Option 1: Add File Upload UI
Create a new file upload component or drag-and-drop interface where users can select COPC files to load.

### Option 2: Hardcode File Paths (for development)
Temporarily set files in `App.tsx`:

```typescript
function App() {
  const [selectedFiles] = useState<string[]>([
    '/output/your-file.copc.laz'  // Add your file path here
  ])
  // ... rest of code
}
```

### Option 3: Use URL Parameters
Load files based on URL query parameters:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const fileParam = params.get('file')
  if (fileParam) {
    setSelectedFiles([fileParam])
  }
}, [])
```

Then access via: `http://localhost:5173/?file=/output/your-file.copc.laz`

## Benefits of This Reorganization

1. **No Automatic Loading:** Application starts faster, doesn't load unwanted data
2. **Consolidated Filters:** All data filtering controls in one intuitive location
3. **Cleaner Right Panel:** Display settings separate from data filters
4. **Better Workflow:** Users apply filters before/without loading, then load specific data
5. **More Flexible:** Easier to add custom file loading mechanisms later

## Testing

The UI compiles successfully with these changes. All TypeScript errors related to our modifications have been resolved.

To test:
1. Start dev server: `npm run dev`
2. FilterPanel should appear at top-left with all three filter controls
3. ControlPanel at top-right should only show display settings and AOI controls
4. No files should auto-load on startup

## Future Enhancements

- Add file upload button to FilterPanel
- Add drag-and-drop COPC file loading
- Add URL-based file loading
- Add recent files list
- Save/load filter presets
- Export filtered data
