# COPC Selective Data Loading Implementation Guide

## Overview

This implementation adds selective data loading capabilities for Cloud Optimized Point Cloud (COPC) data based on:
- **Spatial bounds** (X/Y/Z ranges - longitude, latitude, altitude)
- **Temporal ranges** (GPS time ranges)

The goal is to load only the data you need based on user selections, enabling efficient visualization of large datasets and eventual deployment with S3-hosted tiles using HTTP Range requests.

## What's Been Implemented

### 1. Core Filtering Logic (`src/utils/copcLoaderLOD.ts`)

**New Interfaces:**
- `SpatialBounds`: Defines longitude, latitude, and altitude ranges
- `TimeRange`: Defines GPS time range (TAI93 format)

**Filtering Features:**
- **Octree-based spatial filtering**: Nodes outside spatial bounds are pruned during traversal
- **Point-level filtering**: Individual points are filtered by spatial bounds and GPS time
- **HTTP Range request support**: Uses the `copc` npm library for efficient partial file loading

**Key Methods:**
- `setSpatialBounds()`: Update spatial filter and reload affected nodes
- `setTimeRange()`: Update temporal filter and reload affected nodes
- `getDataBounds()`: Retrieve data bounds for UI validation

### 2. UI Components

**SpatialBoundsPanel** (`src/components/SpatialBoundsPanel.tsx`):
- Manual input fields for min/max longitude, latitude, and altitude
- Validation against absolute data bounds
- Enable/disable toggle
- Apply/Reset functionality

**TimeRangePanel** (`src/components/TimeRangePanel.tsx`):
- GPS time range inputs (TAI93 seconds since 1993-01-01)
- Human-readable UTC date conversion and display
- Enable/disable toggle
- Apply/Reset functionality

### 3. State Management (`src/App.tsx`)

**New State:**
- `spatialBoundsFilter`: Manages spatial bounds filter state
- `timeRangeFilter`: Manages GPS time range filter state

**Handlers:**
- `handleSpatialBoundsFilterChange()`
- `handleResetSpatialBoundsFilter()`
- `handleTimeRangeFilterChange()`
- `handleResetTimeRangeFilter()`

### 4. Integration

All components are wired together:
- App.tsx → ControlPanel → Filter Panels (UI)
- App.tsx → PointCloudViewer (data loading, ready for LOD manager)

## Current Status

✅ **Completed:**
- Filter interfaces and types
- Spatial bounds filtering in octree traversal
- GPS time filtering in point loading
- UI components with manual input fields
- State management integration
- Props passed through component hierarchy

⚠️ **Not Yet Active:**
The filtering is fully implemented in `copcLoaderLOD.ts` but not yet active in the main application. The current data loading still uses `loadCOPCFile()` from `copcLoader.ts` which loads entire files.

## How to Activate Selective Loading

To switch from full-file loading to selective LOD-based loading, modify `PointCloudViewer.tsx`:

### Current Implementation (Full File Loading):
```typescript
// In PointCloudViewer.tsx
import { loadCOPCFile } from '../utils/copcLoader'

// Later in code:
const data = await loadCOPCFile(file, heightFilter)
```

### Switch to LOD-Based Loading:
```typescript
// 1. Import LOD manager
import { COPCLODManager } from '../utils/copcLoaderLOD'

// 2. Create LOD manager instance
const lodManagerRef = useRef<COPCLODManager | null>(null)

// 3. Initialize in useEffect
useEffect(() => {
  const initLOD = async () => {
    if (!globeRef.current) return

    const manager = new COPCLODManager(fileUrl, globeRef.current.scene)
    await manager.initialize()

    // Apply filters
    if (spatialBoundsFilter?.enabled) {
      manager.setSpatialBounds(spatialBoundsFilter)
    }
    if (timeRangeFilter?.enabled) {
      manager.setTimeRange(timeRangeFilter)
    }

    lodManagerRef.current = manager
  }

  initLOD()
}, [files])

// 4. Update camera-based LOD
useEffect(() => {
  const updateLOD = () => {
    if (lodManagerRef.current && globeRef.current) {
      lodManagerRef.current.update(globeRef.current.camera)
    }
    requestAnimationFrame(updateLOD)
  }
  updateLOD()
}, [])

// 5. Update filters when they change
useEffect(() => {
  if (lodManagerRef.current && spatialBoundsFilter) {
    lodManagerRef.current.setSpatialBounds(
      spatialBoundsFilter.enabled ? spatialBoundsFilter : null
    )
  }
}, [spatialBoundsFilter])

useEffect(() => {
  if (lodManagerRef.current && timeRangeFilter) {
    lodManagerRef.current.setTimeRange(
      timeRangeFilter.enabled ? timeRangeFilter : null
    )
  }
}, [timeRangeFilter])
```

## S3 Configuration for HTTP Range Requests

### Prerequisites

Your COPC files must support the COPC format (not just LAZ). Verify with:

```bash
pdal info --all your_file.copc.laz | grep -i copc
```

### S3 Bucket CORS Configuration

For HTTP Range requests to work from your web application, configure S3 CORS:

1. **Go to your S3 bucket** → Permissions → CORS configuration

2. **Add this CORS rule:**

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "http://localhost:5173",
            "http://localhost:3000",
            "https://yourdomain.com"
        ],
        "ExposeHeaders": [
            "Content-Range",
            "Content-Length",
            "Accept-Ranges",
            "ETag"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

**Important Headers:**
- `AllowedHeaders: ["*"]` - Allows the Range header
- `ExposeHeaders` - Exposes headers needed for partial content responses
- `AllowedMethods: ["GET", "HEAD"]` - Enables both full and partial requests

### S3 Static Website Hosting

Enable static website hosting on your bucket:

1. **Go to your S3 bucket** → Properties → Static website hosting
2. **Enable** static website hosting
3. **Set index document** (optional): `index.html`
4. **Note the endpoint URL**: e.g., `http://your-bucket.s3-website-us-east-1.amazonaws.com`

### Bucket Policy (Public Read)

If you want public access:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        }
    ]
}
```

### Testing Range Requests

Test that Range requests work:

```bash
# Test with curl
curl -I -H "Range: bytes=0-1000" \
  https://your-bucket.s3.amazonaws.com/path/to/file.copc.laz

# Should return:
# HTTP/1.1 206 Partial Content
# Content-Range: bytes 0-1000/123456
# Accept-Ranges: bytes
```

If you get `206 Partial Content`, Range requests are working!

## File Structure

```
src/
├── utils/
│   ├── copcLoader.ts          # Original full-file loader (currently active)
│   └── copcLoaderLOD.ts       # New LOD-based selective loader (ready to use)
├── components/
│   ├── SpatialBoundsPanel.tsx # Spatial filter UI
│   ├── SpatialBoundsPanel.css
│   ├── TimeRangePanel.tsx     # Temporal filter UI
│   ├── TimeRangePanel.css
│   ├── ControlPanel.tsx       # Updated with filter panels
│   └── PointCloudViewer.tsx   # Updated with filter props
└── App.tsx                    # Updated with filter state management
```

## Usage Guide

### For End Users

1. **Load a COPC file** using the file selector

2. **Enable Spatial Bounds Filter:**
   - Toggle "Spatial Bounds Filter" to ON
   - Enter longitude range (e.g., -120° to -119°)
   - Enter latitude range (e.g., 35° to 36°)
   - Enter altitude range (e.g., 0 to 10 km)
   - Click "Apply Filter"

3. **Enable GPS Time Range Filter:**
   - Toggle "GPS Time Range Filter" to ON
   - Enter min/max GPS time values (TAI93 seconds)
   - See human-readable UTC dates below each input
   - Click "Apply Filter"

4. **Reset Filters:**
   - Click "Reset" in any panel to restore full data range

### GPS Time Format

GPS times are in **TAI93 format** (seconds since 1993-01-01 00:00:00 UTC).

**Example conversions:**
- `2023-06-30 16:00:00 UTC` = `963417600` seconds
- `2023-06-30 20:00:00 UTC` = `963432000` seconds

The TimeRangePanel automatically displays UTC dates for entered values.

## Performance Considerations

### Current Full-File Loading:
- Loads entire COPC file into memory
- Client-side filtering after load
- Good for: Small files (<500 MB)

### LOD-Based Selective Loading (when activated):
- Loads only visible octree nodes
- HTTP Range requests for partial file access
- Spatial filtering during octree traversal
- Good for: Large files (>500 MB), remote S3 hosting

### Recommended Approach:

| File Size | Location | Recommended Method |
|-----------|----------|-------------------|
| < 500 MB | Local/S3 | Full file loading (current) |
| 500 MB - 2 GB | S3 | LOD with Range requests |
| > 2 GB | S3 | LOD + server-side query API |

## Troubleshooting

### CORS Errors

**Error:** `Access to fetch at 'https://...' has been blocked by CORS policy`

**Solution:**
1. Verify S3 CORS configuration includes Range header
2. Ensure `ExposeHeaders` includes `Content-Range` and `Accept-Ranges`
3. Add your domain to `AllowedOrigins`

### No Partial Content (206) Response

**Error:** Getting `200 OK` instead of `206 Partial Content`

**Solution:**
1. Verify file is proper COPC format with `pdal info`
2. Ensure S3 supports Range requests (it does by default)
3. Check that `Accept-Ranges: bytes` header is present

### Points Not Filtering

**Error:** Filter UI shows correct values but no filtering occurs

**Solution:**
1. Verify you've switched to `COPCLODManager` (see "How to Activate" section)
2. Check that filters are being passed to the LOD manager
3. Confirm filter `enabled` flag is set to `true`

### Slow Performance

**Issue:** Filtering is slow or choppy

**Solutions:**
- Reduce point budget in `COPCLODManager` (default: 2M points)
- Increase LOD threshold for more aggressive culling
- Use coarser spatial bounds to load fewer nodes
- Enable browser caching for repeated requests

## Next Steps / Future Enhancements

1. **Activate LOD loading** in production (switch from `loadCOPCFile` to `COPCLODManager`)
2. **Add interactive spatial selection** (draw bounds on map instead of manual input)
3. **Implement node caching** (IndexedDB for offline use)
4. **Server-side filtering API** for very large datasets (>2 GB)
5. **Time slider UI** for easier GPS time range selection
6. **Preset filters** (save/load common filter configurations)
7. **Export filtered data** (download only filtered points as LAZ)

## Technical Details

### COPC Octree Structure

COPC organizes points in an octree hierarchy:
- **Root node**: Contains overview of entire dataset
- **Child nodes**: Recursively subdivide space in 8 octants
- **Leaf nodes**: Contain actual point data

The LOD manager:
1. Loads octree metadata (small, fast)
2. Traverses octree based on camera frustum and distance
3. Loads only visible nodes using HTTP Range requests
4. Applies filters at two levels:
   - **Node level**: Skip nodes outside spatial bounds
   - **Point level**: Filter individual points by spatial + temporal bounds

### Memory Management

- **Point budget**: Limits total points displayed (default: 2M)
- **Node unloading**: Nodes outside frustum are unloaded from memory
- **Geometry disposal**: Three.js geometries properly disposed on unload

### HTTP Range Request Optimization

Each node load uses a Range request:
```
GET /file.copc.laz HTTP/1.1
Range: bytes=1234567-1234890
```

Benefits:
- Only download bytes needed for specific nodes
- Parallel requests for multiple nodes
- No server-side processing required
- Works with standard S3/CDN

## References

- [COPC Specification](https://copc.io/)
- [AWS S3 CORS Configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
- [HTTP Range Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
- [PDAL COPC Support](https://pdal.io/en/latest/workshop/exercises/analysis/copc.html)

## Support

For issues or questions about this implementation, refer to:
- `src/utils/copcLoaderLOD.ts` - Core filtering logic
- `src/components/SpatialBoundsPanel.tsx` - Spatial UI
- `src/components/TimeRangePanel.tsx` - Temporal UI
- This guide for setup and configuration
