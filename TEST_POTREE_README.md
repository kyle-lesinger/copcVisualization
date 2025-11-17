# Testing Potree Loader

This document explains how to test the Potree point cloud loader with a simple standalone HTML file.

## Quick Start

### 1. Start the Development Server

```bash
npm run dev
```

### 2. Open the Test File

Navigate to: http://localhost:5173/test-potree.html

(Adjust port if your dev server uses a different port)

## What the Test Does

The `test-potree.html` file is a minimal standalone test that:

- Loads one Potree directory: `/potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD`
- Parses the Potree metadata.json and octree.bin files
- Displays up to 1 million points (limited for performance)
- Colors points by elevation using a plasma-like colormap
- Provides orbit controls for viewing

## Expected Results

If everything is working correctly, you should see:

- A 3D point cloud visualization
- Stats panel showing:
  - Points loaded: ~1,000,000
  - Geographic bounds (longitude, latitude, altitude)
  - Status: ✅ Loaded successfully

## Controls

- **Mouse drag**: Rotate view
- **Scroll wheel**: Zoom in/out
- **Right-click drag**: Pan view

## Troubleshooting

### "Failed to fetch metadata" Error

This means the Potree data is not accessible. Check:

1. The `public/potree_data` symlink exists:
   ```bash
   ls -la public/ | grep potree
   ```
   Should show: `potree_data -> ../potree_data`

2. The Potree data directory exists:
   ```bash
   ls potree_data/
   ```
   Should list directories like `CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD`

3. Each directory contains the required files:
   ```bash
   ls potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD/
   ```
   Should show: `metadata.json`, `octree.bin`, `hierarchy.bin`

### No Points Visible

- Check browser console for errors
- Verify the camera is positioned correctly (the test auto-centers on the data)
- Try zooming out (scroll wheel)

## Next Steps

Once this test works:

1. Test the full application at http://localhost:5173/
2. Select the Date Range filter (2023-06-30)
3. Click "Search Files"
4. Select one or more Potree files
5. Verify they load in both 2D and 3D modes

## Technical Details

The test file demonstrates:

- **Potree metadata parsing**: Reading metadata.json
- **Binary point data parsing**: Reading octree.bin with proper attribute offsets
- **Point limit**: First 1M points only (full app uses LOD for all points)
- **Elevation coloring**: Simple plasma-like gradient based on altitude
- **Three.js rendering**: Basic point cloud visualization

The full application uses `PotreeLODManager` which provides:
- Progressive loading with level-of-detail (LOD)
- Frustum culling for performance
- Spatial and temporal filtering
- 2M point budget management
- Multiple colormap options
