# Architecture Overview

## System Design

The CALIPSO COPC Viewer is a browser-based point cloud visualization application built with modern web technologies. This document explains the component hierarchy, state management, rendering pipeline, and design patterns used throughout the application.

## Technology Stack

### Core Frameworks

**React 18**
- Component-based UI
- Hooks for state and side effects
- Virtual DOM for efficient updates
- Concurrent rendering features

**TypeScript**
- Static type checking
- Enhanced IDE support
- Self-documenting code
- Refactoring safety

**Vite**
- Fast HMR (Hot Module Replacement)
- ES modules native support
- Optimized production builds
- Plugin ecosystem

### Rendering Engines

**Three.js** (3D Globe View)
- WebGL wrapper for 3D graphics
- Scene graph management
- Built-in camera and controls
- Geometry and material system

**deck.gl** (2D Map View)
- WebGL-based 2D/3D visualization
- Optimized layer system
- MapLibre integration
- High-performance rendering

### Data Loading

**loaders.gl**
- Unified loader interface
- LAZ/COPC parsing
- Web Worker support
- WASM-based decompression (laz-perf)

### Additional Libraries

- **Plotly.js**: Scatter plot visualization
- **MapLibre GL JS**: Base map tiles and controls

## Component Hierarchy

### Visual Diagram

```
App.tsx (Root)
├── PointCloudViewer.tsx (Orchestrator)
│   ├── GlobeViewer.tsx (Three.js 3D)
│   │   └── [Three.js Scene]
│   │       ├── Earth sphere mesh
│   │       ├── Stars background
│   │       ├── Satellite model
│   │       ├── Point cloud (THREE.Points)
│   │       └── AOI polygon line
│   │
│   ├── DeckGLMapView.tsx (deck.gl 2D)
│   │   └── [deck.gl Layers]
│   │       ├── ScatterplotLayer (point cloud)
│   │       └── PolygonLayer (AOI)
│   │
│   └── AOIScatterPlot.tsx (Plotly modal)
│       └── [Plotly.js Chart]
│
├── ControlPanel.tsx (Settings UI)
│   ├── Color mode selector
│   ├── Colormap selector
│   ├── Point size slider
│   ├── View mode toggle
│   ├── AOI controls
│   └── Satellite animation controls
│
└── FileSelector.tsx (File picker)
    ├── File mode toggle
    └── File checkboxes
```

### Component Responsibilities

**App.tsx**
- Root component
- Global state management
- Callback orchestration
- Props distribution

**PointCloudViewer.tsx**
- Data loading coordinator
- COPC file fetching
- Color computation
- View mode switching
- Data filtering (AOI)

**GlobeViewer.tsx**
- Three.js scene setup
- Camera and controls
- Satellite animation
- 3D polygon drawing
- Raycasting for clicks

**DeckGLMapView.tsx**
- deck.gl initialization
- 2D layer management
- MapLibre integration
- 2D polygon drawing

**ControlPanel.tsx**
- UI controls rendering
- User input handling
- Data info display
- Animation controls

**FileSelector.tsx**
- File mode selection
- Multi-file selection
- File list rendering

**AOIScatterPlot.tsx**
- Modal dialog
- Plotly.js plot
- Plot configuration

## State Management

### State Location Strategy

**Component-local state** (useState):
- Used for: UI state, loading indicators, local toggles
- Examples: `loading`, `error`, `showScatterPlot`

**Lifted state** (App.tsx):
- Used for: Shared data, cross-component state
- Examples: `colorMode`, `viewMode`, `aoiPolygon`

**Refs** (useRef):
- Used for: Three.js objects, DOM nodes, mutable values
- Examples: `globeRef`, `pointCloudsRef`, `dataRef`

### Key State Variables

**App.tsx state**:
```typescript
const [fileMode, setFileMode] = useState<FileMode>('tiled')
const [selectedFiles, setSelectedFiles] = useState<string[]>([...])
const [colorMode, setColorMode] = useState<ColorMode>('intensity')
const [colormap, setColormap] = useState<Colormap>('plasma')
const [pointSize, setPointSize] = useState(2.0)
const [viewMode, setViewMode] = useState<ViewMode>('space')
const [dataRange, setDataRange] = useState<DataRange>({ elevation: null, intensity: null })
const [aoiPolygon, setAoiPolygon] = useState<LatLon[] | null>(null)
const [isDrawingAOI, setIsDrawingAOI] = useState(false)
const [hasAOIData, setHasAOIData] = useState(false)
const [aoiPointCount, setAoiPointCount] = useState<number>(0)
const [showScatterPlotTrigger, setShowScatterPlotTrigger] = useState(false)
const [firstPoint, setFirstPoint] = useState<Point | null>(null)
const [lastPoint, setLastPoint] = useState<Point | null>(null)
const [currentGpsTime, setCurrentGpsTime] = useState<number | null>(null)
const [currentPosition, setCurrentPosition] = useState<{ lat: number, lon: number } | null>(null)
const [animateSatelliteTrigger, setAnimateSatelliteTrigger] = useState(false)
```

**PointCloudViewer refs**:
```typescript
const globeRef = useRef<GlobeViewerHandle>(null)
const deckMapRef = useRef<DeckGLMapViewHandle>(null)
const pointCloudsRef = useRef<THREE.Points[]>([])
const dataRef = useRef<PointCloudData[]>([])
```

### Ref Handles Pattern

**Purpose**: Allow parent components to call child methods

**Example** (GlobeViewer):

```typescript
export interface GlobeViewerHandle {
  getScene: () => THREE.Scene | null
  setViewMode: (mode: ViewMode) => void
  setDrawingMode: (drawing: boolean) => void
  clearPolygon: () => void
  animateSatelliteToFirstPoint: (
    firstPoint: Point,
    lastPoint: Point,
    positions?: Float32Array
  ) => void
}

const GlobeViewer = forwardRef<GlobeViewerHandle, GlobeViewerProps>((props, ref) => {
  // ... component implementation ...

  useImperativeHandle(ref, () => ({
    getScene: () => sceneRef.current,
    setViewMode: (mode) => { /* ... */ },
    setDrawingMode: (drawing) => { /* ... */ },
    clearPolygon: () => { /* ... */ },
    animateSatelliteToFirstPoint: (firstPoint, lastPoint, positions) => { /* ... */ }
  }))

  return <canvas ref={canvasRef} />
})
```

**Usage** (in parent):
```typescript
globeRef.current?.animateSatelliteToFirstPoint(firstPoint, lastPoint, positions)
```

## Data Flow

### Loading Pipeline

```
User selects files
  ↓
App.tsx: setSelectedFiles([...])
  ↓
PointCloudViewer: useEffect(files) triggers
  ↓
Promise.all(files.map(loadCOPCFile))
  ↓
For each file:
  - fetch() HTTP request
  - parse() with loaders.gl (Web Worker)
  - Extract positions, intensities, classifications
  - Decimate to 5M points
  - Compute initial colors
  - Find first/last points
  ↓
All files loaded
  ↓
Compute global ranges (elevation, intensity)
  ↓
Create THREE.Points for globe view
  ↓
Store data in dataRef.current
  ↓
setDataLoaded(true), setDataVersion(prev => prev + 1)
  ↓
Components re-render with new data
```

### Color Update Flow

```
User changes color mode or colormap
  ↓
App.tsx: setColorMode(...) or setColormap(...)
  ↓
PointCloudViewer: useEffect(colorMode, colormap) triggers
  ↓
For each dataset:
  - computeElevationColors() or computeIntensityColors() or computeClassificationColors()
  - Updates data.colors in-place
  ↓
For globe view:
  - Update THREE.BufferAttribute color array
  - Set needsUpdate = true
  ↓
For 2D view:
  - setDataVersion(prev => prev + 1)
  - Triggers DeckGLMapView re-render
  ↓
GPU receives new colors
  ↓
Visual update on screen
```

### AOI Selection Flow

```
User clicks "Select AOI"
  ↓
App.tsx: setIsDrawingAOI(true)
  ↓
PointCloudViewer: useEffect(isDrawingAOI) sets drawing mode on viewer
  ↓
GlobeViewer/DeckGLMapView: Enable click handlers
  ↓
User clicks points
  ↓
Each click: Add vertex to local polygonPoints array
  ↓
Real-time polygon line visualization updates
  ↓
User clicks "Finish AOI"
  ↓
onPolygonComplete(polygonPoints) callback
  ↓
PointCloudViewer: handlePolygonComplete
  ↓
App.tsx: setAoiPolygon(polygon), setIsDrawingAOI(false)
  ↓
PointCloudViewer: useEffect(aoiPolygon) triggers
  ↓
filterDataByAOI() runs
  ↓
Point-in-polygon test for all points
  ↓
Extract altitudes and intensities for points inside
  ↓
setAoiData({ altitudes, intensities })
  ↓
onAOIDataReady(true, pointCount) callback
  ↓
App.tsx: Updates AOI state
  ↓
ControlPanel: "Plot" button enabled
  ↓
User clicks "Plot"
  ↓
setShowScatterPlotTrigger(prev => !prev)
  ↓
PointCloudViewer: setShowScatterPlot(true)
  ↓
AOIScatterPlot modal renders
```

## Rendering Pipeline

### Three.js Rendering (Globe View)

**Setup** (GlobeViewer.tsx):

```typescript
// 1. Create scene
const scene = new THREE.Scene()

// 2. Create camera
const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)
camera.position.set(0, 0, 20)

// 3. Create renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(width, height)
renderer.setPixelRatio(window.devicePixelRatio)

// 4. Add objects
const earth = createEarthSphere()
const stars = createStarsBackground()
const satellite = createSatelliteModel()
scene.add(earth, stars, satellite)

// 5. Animation loop
const animate = () => {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
animate()
```

**Point cloud rendering**:

```typescript
// Create geometry
const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', new THREE.BufferAttribute(globePositions, 3))
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true))

// Create material
const material = new THREE.PointsMaterial({
  size: pointSize * 0.002,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.8
})

// Create points object
const points = new THREE.Points(geometry, material)
scene.add(points)
```

**Rendering characteristics**:
- Frame rate: 60 FPS target (via requestAnimationFrame)
- Point count: 5M vertices → 5M point sprites on GPU
- Culling: Three.js frustum culling automatic
- Depth testing: Enabled for correct occlusion

### deck.gl Rendering (2D View)

**Setup** (DeckGLMapView.tsx):

```typescript
// 1. Create deck.gl instance
const deck = new Deck({
  canvas: canvasRef.current,
  initialViewState: {
    longitude: center[0],
    latitude: center[1],
    zoom: zoom,
    pitch: 0,
    bearing: 0
  },
  controller: true
})

// 2. Create layers
const pointLayer = new ScatterplotLayer({
  id: 'point-cloud',
  data: pointData,
  getPosition: (d) => [d.lon, d.lat, d.alt * 1000],
  getColor: (d) => d.color,
  getRadius: pointSize,
  radiusUnits: 'pixels',
  opacity: 0.8
})

// 3. Update deck
deck.setProps({ layers: [pointLayer] })
```

**Layer updates**:

```typescript
useEffect(() => {
  // Recreate layer when data changes
  const newLayer = new ScatterplotLayer({
    id: `point-cloud-${dataVersion}`,  // New ID forces update
    data: flattenedData,
    // ... props
  })

  deckRef.current?.setProps({ layers: [newLayer, polygonLayer] })
}, [dataVersion, pointSize, colorMode])
```

**Rendering characteristics**:
- Frame rate: 60 FPS (deck.gl animation loop)
- Instancing: GPU instancing for efficient point rendering
- Viewport culling: Automatic (deck.gl only renders visible points)
- LOD: deck.gl can adaptively reduce detail at high zoom (not used currently)

## Performance Patterns

### Memoization

**useCallback** for stable callback references:

```typescript
const handlePolygonComplete = useCallback((polygon: LatLon[]) => {
  onPolygonUpdate?.(polygon)
}, [onPolygonUpdate])
```

Prevents child components from re-rendering unnecessarily.

**useMemo** for expensive computations:

```typescript
const flattenedData = useMemo(() => {
  return data.flatMap(d => {
    const result = []
    for (let i = 0; i < d.positions.length; i += 3) {
      result.push({
        lon: d.positions[i],
        lat: d.positions[i + 1],
        alt: d.positions[i + 2],
        color: [d.colors[i * 3], d.colors[i * 3 + 1], d.colors[i * 3 + 2]]
      })
    }
    return result
  })
}, [data, dataVersion])
```

Recomputes only when dependencies change.

### Typed Arrays

**Throughout pipeline**: Use Float32Array and Uint8Array

**Benefits**:
- Fixed size (no dynamic resizing overhead)
- Contiguous memory (CPU cache friendly)
- Direct GPU upload (no conversion needed)
- ~2-10x faster than regular arrays

**Example**:
```typescript
const positions = new Float32Array(pointCount * 3)  // Not: []
const colors = new Uint8Array(pointCount * 3)       // Not: []
```

### Web Workers

**loaders.gl uses workers** for LAZ decompression:

```typescript
const parsedData = await parse(arrayBuffer, LASLoader, {
  las: { /* ... */ },
  worker: true,  // ← Offload to Web Worker
  onProgress: (progress) => { /* ... */ }
})
```

**Benefit**: Main thread stays responsive during 2-3 second parse.

### In-Place Updates

**Color buffer updates** (avoid re-allocation):

```typescript
// GOOD: Modify existing array
computeElevationColors(data.positions, data.colors, min, max, colormap)
colorAttribute.needsUpdate = true

// BAD: Create new array
// data.colors = new Uint8Array(...)
```

**DrawRange** (progressive rendering):

```typescript
// GOOD: Modify draw range
geometry.setDrawRange(0, visiblePointCount)

// BAD: Create new geometry with subset
// geometry = new THREE.BufferGeometry().setFromPoints(points.slice(0, visiblePointCount))
```

## Design Patterns

### Container/Presentational Pattern

**Container components** (logic, state):
- App.tsx
- PointCloudViewer.tsx

**Presentational components** (UI, rendering):
- ControlPanel.tsx
- FileSelector.tsx
- AOIScatterPlot.tsx

**Benefits**:
- Separation of concerns
- Easier testing
- Reusable UI components

### Render Props Pattern

**deck.gl layers** use accessor functions:

```typescript
new ScatterplotLayer({
  data: points,
  getPosition: (d) => [d.lon, d.lat, d.alt],  // ← Render prop
  getColor: (d) => d.color,                   // ← Render prop
  getRadius: (d) => pointSize                 // ← Render prop
})
```

### Ref Forwarding Pattern

**Three.js components** expose imperative API:

```typescript
const GlobeViewer = forwardRef<GlobeViewerHandle, Props>((props, ref) => {
  useImperativeHandle(ref, () => ({
    getScene: () => sceneRef.current,
    animateSatelliteToFirstPoint: (...) => { /* ... */ }
  }))

  return <canvas ref={canvasRef} />
})
```

**Usage**:
```typescript
globeRef.current?.animateSatelliteToFirstPoint(...)
```

### Trigger Pattern

**For one-time actions** (not continuous state):

```typescript
const [trigger, setTrigger] = useState(false)

// Trigger action by toggling
setTrigger(prev => !prev)

// React to trigger
useEffect(() => {
  if (trigger) {
    performAction()
  }
}, [trigger])
```

**Used for**: `showScatterPlotTrigger`, `animateSatelliteTrigger`

**Why not just call function directly?**
- Props can only be data, not functions (in some cases)
- Allows parent to trigger child action without direct ref access
- Works across component boundaries

## Error Handling

### Loading Errors

**Pattern**:
```typescript
setLoading(true)
setError(null)

try {
  const data = await loadCOPCFile(file)
  // ... success path
  setLoading(false)
} catch (err) {
  console.error('Error loading COPC files:', err)
  setError(err.message || 'Failed to load COPC files')
  setLoading(false)
}
```

**UI feedback**:
```typescript
{error && (
  <div className="error-overlay">
    <div className="error-message">
      <strong>Error:</strong> {error}
    </div>
  </div>
)}
```

### Validation Errors

**GPS time parsing**:
```typescript
if (gpsTime <= 0 || gpsTime > 1e10 || !isFinite(gpsTime)) {
  console.warn('GPS time invalid, trying fallback')
  gpsTime = tryAlternativeOffset()
}
```

**AOI polygon**:
```typescript
if (!aoiPolygon || aoiPolygon.length < 3) {
  setAoiData(null)
  onAOIDataReady?.(false, 0)
  return
}
```

### Graceful Degradation

**Missing features**:
```typescript
if (!positions) {
  // Fallback: Use linear interpolation instead of position sampling
  currentLat = firstPoint.lat + (lastPoint.lat - firstPoint.lat) * progress
  currentLon = firstPoint.lon + (lastPoint.lon - firstPoint.lon) * progress
}
```

**Invalid times**:
```typescript
if (displayTime > 0 && displayTime < 1e10) {
  return formatTaiTime(displayTime)
} else {
  return `Point ${Math.floor(displayTime)}`  // Fallback to index
}
```

## Build and Deployment

### Development Build

```bash
npm run dev
```

**Features**:
- Vite dev server on port 3002
- Hot Module Replacement (HMR)
- Source maps for debugging
- Fast rebuild (<100ms for most changes)

### Production Build

```bash
npm run build
```

**Process**:
1. TypeScript compilation (check types)
2. Tree shaking (remove unused code)
3. Minification (Terser for JS, cssnano for CSS)
4. Code splitting (vendor chunks separate from app code)
5. Asset optimization (hash names for caching)

**Output** (`dist/`):
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js      (Main app bundle)
│   ├── vendor-[hash].js     (Three.js, deck.gl, React)
│   ├── index-[hash].css
│   └── ...
└── output/ (symlink to COPC files)
```

### Deployment

**Static hosting** (Netlify, Vercel, GitHub Pages):
- Deploy `dist/` folder
- Configure to serve `index.html` for all routes (SPA)
- Set up COPC file serving (CORS headers if needed)

**CDN considerations**:
- COPC files are large (100-200 MB)
- Consider CDN with HTTP range support for future streaming
- Brotli/Gzip compression (LAZ already compressed, skip for .laz files)

## Testing Strategy

### Current State

**No automated tests** currently implemented.

### Recommended Test Structure

**Unit tests** (Jest + React Testing Library):
```typescript
// copcLoader.test.ts
test('taiToDate converts TAI seconds correctly', () => {
  const tai = 963500683.0
  const date = taiToDate(tai)
  expect(date.getUTCFullYear()).toBe(2023)
})

// aoiSelector.test.ts
test('isPointInPolygon correctly identifies points inside polygon', () => {
  const polygon = [
    { lat: 0, lon: 0 },
    { lat: 1, lon: 0 },
    { lat: 1, lon: 1 },
    { lat: 0, lon: 1 }
  ]
  expect(isPointInPolygon({ lat: 0.5, lon: 0.5 }, polygon)).toBe(true)
  expect(isPointInPolygon({ lat: 2, lon: 2 }, polygon)).toBe(false)
})
```

**Component tests**:
```typescript
// ControlPanel.test.tsx
test('displays data ranges correctly', () => {
  const dataRange = {
    elevation: [0, 40],
    intensity: [100, 5000]
  }
  render(<ControlPanel dataRange={dataRange} {...otherProps} />)
  expect(screen.getByText(/0.00 to 40.00 km/)).toBeInTheDocument()
})
```

**Integration tests**:
```typescript
// App.integration.test.tsx
test('loads COPC file and displays points', async () => {
  render(<App />)
  // ... simulate file selection
  await waitFor(() => {
    expect(screen.getByText(/5,000,000 points/)).toBeInTheDocument()
  })
})
```

## Future Architecture Improvements

### 1. State Management Library

**Current**: Props drilling, lifted state

**Future**: Zustand or Jotai

**Benefits**:
- Centralized state
- Less prop threading
- Better debugging (Redux DevTools)

```typescript
// store.ts
const useStore = create((set) => ({
  colorMode: 'intensity',
  setColorMode: (mode) => set({ colorMode: mode }),
  // ... other state
}))

// Component
const colorMode = useStore(state => state.colorMode)
const setColorMode = useStore(state => state.setColorMode)
```

### 2. WebGL Context Sharing

**Current**: Three.js and deck.gl use separate canvases

**Future**: Share single WebGL context

**Benefits**:
- Lower memory usage
- Fewer draw calls
- Potential for hybrid rendering (3D globe with deck.gl layers)

### 3. Web Worker Point Filtering

**Current**: AOI filtering blocks main thread

**Future**: Run filterDataByAOI in Web Worker

```typescript
// worker.ts
self.onmessage = (e) => {
  const { positions, intensities, polygon } = e.data
  const result = filterDataByAOI(positions, intensities, polygon)
  self.postMessage(result)
}

// Component
const worker = new Worker('worker.ts')
worker.postMessage({ positions, intensities, polygon })
worker.onmessage = (e) => setAoiData(e.data)
```

### 4. Streaming COPC

**Current**: Load entire file before rendering

**Future**: EPT hierarchy streaming

**Benefits**:
- <1s time to first point
- Progressive refinement
- View-dependent LOD

### 5. TypeScript Strictness

**Current**: Some `any` types, optional strict mode

**Future**: Enable `strict: true` in tsconfig

**Changes needed**:
- Explicit typing for all loaders.gl data
- Stricter null checks
- No implicit `any`

## Conclusion

The CALIPSO COPC Viewer architecture successfully balances:

- **Performance**: Typed arrays, Web Workers, GPU rendering
- **Maintainability**: Component separation, TypeScript, clear data flow
- **Flexibility**: Multiple view modes, pluggable renderers
- **Extensibility**: Ref handles, callback props, modular design

**Key architectural decisions**:

1. **Dual rendering engines** (Three.js + deck.gl) for 3D and 2D
2. **Lifted state pattern** for cross-component data sharing
3. **Ref handles** for imperative child control
4. **In-place updates** for performance-critical operations
5. **Typed arrays** throughout the pipeline

The architecture enables rich, interactive visualization of massive satellite datasets (35M+ points) in a browser, while remaining maintainable and extensible for future enhancements.
