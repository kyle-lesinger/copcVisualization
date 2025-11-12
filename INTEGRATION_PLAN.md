# Integration Plan: COPCLODManager

## Current vs. Desired Architecture

### Current (Using Simple Loader):
```
PointCloudViewer.tsx
  ↓
loadCOPCFile() - loads entire file
  ↓
Creates THREE.Points manually
  ↓
Manual decimation & filtering
```

### Desired (Using LOD Manager):
```
PointCloudViewer.tsx
  ↓
COPCLODManager.initialize()
  ↓
manager.update(camera) - automatic octree traversal
  ↓
Dynamic node loading/unloading
```

## Integration Steps

### Step 1: Modify PointCloudViewer State
**Add:**
```typescript
const lodManagersRef = useRef<COPCLODManager[]>([])
```

**Remove:**
- Manual point cloud creation
- Manual decimation logic
- Manual geometry management

### Step 2: Replace File Loading Logic
**Replace:**
```typescript
Promise.all(files.map(file => loadCOPCFile(file)))
```

**With:**
```typescript
Promise.all(files.map(file => {
  const manager = new COPCLODManager(file, scene)
  await manager.initialize()

  if (spatialBoundsFilter?.enabled) {
    manager.setSpatialBounds(spatialBoundsFilter)
  }

  return manager
}))
```

### Step 3: Add Update Loop
**Add render loop:**
```typescript
useEffect(() => {
  if (viewMode !== 'space') return

  const updateLoop = () => {
    if (globeRef.current) {
      const camera = globeRef.current.getCamera()

      // Update all LOD managers
      lodManagersRef.current.forEach(manager => {
        manager.update(camera)
      })
    }

    animationFrameRef.current = requestAnimationFrame(updateLoop)
  }

  updateLoop()

  return () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
  }
}, [viewMode])
```

### Step 4: Update Filter Handlers
**Replace manual filtering with:**
```typescript
useEffect(() => {
  if (!spatialBoundsFilter) return

  lodManagersRef.current.forEach(manager => {
    manager.setSpatialBounds(spatialBoundsFilter)
  })
}, [spatialBoundsFilter])
```

### Step 5: Update Color/Size Handlers
**Replace with:**
```typescript
useEffect(() => {
  lodManagersRef.current.forEach(manager => {
    manager.setColorMode(colorMode, colormap)
  })
}, [colorMode, colormap])

useEffect(() => {
  lodManagersRef.current.forEach(manager => {
    manager.setPointSize(pointSize)
  })
}, [pointSize])
```

## Detailed Code Changes

### File: `src/components/PointCloudViewer.tsx`

#### Change 1: Imports
```typescript
// ADD:
import { COPCLODManager, SpatialBounds } from '../utils/copcLoaderLOD'

// REMOVE (or keep for 2D fallback):
import { loadCOPCFile, PointCloudData } from '../utils/copcLoader'
```

#### Change 2: State Management
```typescript
// REPLACE pointCloudsRef and dataRef with:
const lodManagersRef = useRef<COPCLODManager[]>([])

// KEEP these for 2D mode:
const dataRef = useRef<PointCloudData[]>([]) // For 2D fallback
```

#### Change 3: File Loading Effect
```typescript
useEffect(() => {
  if (files.length === 0) {
    // Cleanup
    lodManagersRef.current.forEach(m => m.dispose())
    lodManagersRef.current = []
    setLoading(false)
    return
  }

  setLoading(true)

  // For 3D mode: Use LOD manager
  if (viewMode !== '2d') {
    loadWithLODManager()
  } else {
    // For 2D mode: Use simple loader (keep existing logic)
    loadWithSimpleLoader()
  }
}, [files, viewMode])

async function loadWithLODManager() {
  const scene = globeRef.current?.getScene()
  if (!scene) return

  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║     📂 LOADING COPC FILES WITH LOD MANAGER (OPTIMIZED)    ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')

  try {
    // Initialize LOD managers for each file
    const managers = await Promise.all(
      files.map(async (file, index) => {
        console.log(`[PointCloudViewer] Initializing LOD manager for file ${index + 1}/${files.length}`)

        const manager = new COPCLODManager(file, scene)
        await manager.initialize()

        // Apply spatial bounds if enabled
        if (spatialBoundsFilter?.enabled) {
          manager.setSpatialBounds({
            enabled: true,
            minLon: spatialBoundsFilter.minLon,
            maxLon: spatialBoundsFilter.maxLon,
            minLat: spatialBoundsFilter.minLat,
            maxLat: spatialBoundsFilter.maxLat,
            minAlt: spatialBoundsFilter.minAlt,
            maxAlt: spatialBoundsFilter.maxAlt
          })
        }

        // Set color mode and point size
        manager.setColorMode(colorMode, colormap)
        manager.setPointSize(pointSize * 0.002) // Scale for globe

        return manager
      })
    )

    lodManagersRef.current = managers

    console.log(`[PointCloudViewer] ✅ ${managers.length} LOD manager(s) initialized`)
    console.log(`[PointCloudViewer] 🎯 Point budget: ${managers[0].getStats().totalPoints} points`)

    setLoading(false)
    setDataLoaded(true)

  } catch (error) {
    console.error('Error loading with LOD manager:', error)
    setError(error.message)
    setLoading(false)
  }
}
```

#### Change 4: Update Loop
```typescript
// Add LOD update loop
useEffect(() => {
  if (viewMode !== 'space' || lodManagersRef.current.length === 0) return

  let animationFrame: number

  const updateLoop = () => {
    const camera = globeRef.current?.getCamera()
    if (camera) {
      // Update all LOD managers based on camera position
      lodManagersRef.current.forEach(manager => {
        manager.update(camera)
      })
    }

    animationFrame = requestAnimationFrame(updateLoop)
  }

  updateLoop()

  return () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
  }
}, [viewMode, dataLoaded])
```

#### Change 5: Filter Updates
```typescript
// Spatial bounds filter
useEffect(() => {
  if (!spatialBoundsFilter || lodManagersRef.current.length === 0) return

  const bounds: SpatialBounds | null = spatialBoundsFilter.enabled ? {
    enabled: true,
    minLon: spatialBoundsFilter.minLon,
    maxLon: spatialBoundsFilter.maxLon,
    minLat: spatialBoundsFilter.minLat,
    maxLat: spatialBoundsFilter.maxLat,
    minAlt: spatialBoundsFilter.minAlt,
    maxAlt: spatialBoundsFilter.maxAlt
  } : null

  lodManagersRef.current.forEach(manager => {
    manager.setSpatialBounds(bounds)
  })
}, [spatialBoundsFilter])

// Color mode
useEffect(() => {
  lodManagersRef.current.forEach(manager => {
    manager.setColorMode(colorMode, colormap)
  })
}, [colorMode, colormap])

// Point size
useEffect(() => {
  lodManagersRef.current.forEach(manager => {
    manager.setPointSize(pointSize * 0.002)
  })
}, [pointSize])
```

#### Change 6: Cleanup
```typescript
useEffect(() => {
  return () => {
    // Cleanup LOD managers on unmount
    lodManagersRef.current.forEach(manager => {
      manager.dispose()
    })
    lodManagersRef.current = []
  }
}, [])
```

## Benefits After Integration

### Performance Improvements:
| Metric | Before (Simple Loader) | After (LOD Manager) |
|--------|----------------------|-------------------|
| Initial Download | 73 MB (full file) | ~5-15 MB (visible nodes only) |
| Memory Usage | 4.3M points always | 500K-2M points (dynamic) |
| Load Time | 5-10 seconds | 1-2 seconds (progressive) |
| Frame Rate | 30-60 FPS | 60 FPS (consistent) |

### Features Gained:
- ✅ Progressive loading (see data immediately)
- ✅ HTTP Range Requests (only download visible chunks)
- ✅ Automatic LOD (detail based on distance)
- ✅ View frustum culling (only render visible nodes)
- ✅ Memory optimization (unload distant nodes)
- ✅ Spatial filtering at octree level (skip entire nodes)

### Logging Output:
```
[COPCLODManager] Initializing COPC file: /output/file.copc.laz
[COPCLODManager] COPC Info: { pointCount: 35063762, bounds: {...} }
[COPCLODManager] Loaded hierarchy nodes: 1247
[COPCLODManager] Total nodes in hierarchy: 1247

[COPCLODManager] 📍 SPATIAL BOUNDS FILTER APPLIED
[COPCLODManager] 🔍 Selective loading enabled
[COPCLODManager] ⚡ Octree optimization: Only nodes intersecting filter bounds will be loaded

[COPCLODManager] 📦 Loading node 0-0-0-0 (125,432 points) with filters...
[COPCLODManager] ✂️  Point-level filtering applied to node 0-0-0-0:
  • Original points in node: 125,432
  • Points after filtering:  18,234
  • Points filtered out:     107,198 (85.5%)
  ⚡ Only 18,234 points loaded into memory!

[COPCLODManager] 🚫 Octree node 1-2-3-0 SKIPPED - outside spatial bounds
  Node bounds: [-180.00, -90.00, 0.00] to [-150.00, -60.00, 5.00]
  ⚡ Saved 43,287 points from being loaded!

[COPCLODManager] Current points: 427,891 / 2,000,000
```

## Migration Strategy

### Phase 1: Parallel Implementation (Recommended)
Keep both loaders working:
- **3D Space View**: Use LOD Manager
- **2D Map View**: Keep simple loader

This allows gradual migration and fallback.

### Phase 2: Complete Migration
Once LOD manager is tested and working:
- Remove simple loader from 3D mode entirely
- Consider migrating 2D mode to use pre-loaded LOD data

## Testing Plan

1. **Test with Spatial Filter**
   - Set lat 0-20°
   - Verify only ~15% of nodes load
   - Check HTTP requests show only partial file downloads

2. **Test LOD Behavior**
   - Zoom in/out on globe
   - Verify detail increases when close
   - Check point count changes dynamically

3. **Test View Frustum Culling**
   - Rotate globe to show/hide regions
   - Verify nodes load/unload as they enter/exit view

4. **Test Performance**
   - Monitor frame rate
   - Check memory usage
   - Verify no memory leaks

## Next Steps

1. Should I implement the full integration? (Large refactor)
2. Or create a minimal working example first? (Test concept)
3. Or update the existing copcLoaderLOD.ts first? (Fix any issues)

Choose your preference and I'll proceed!
