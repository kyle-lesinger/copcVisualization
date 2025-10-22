# CALIPSO COPC Viewer

A web-based visualization platform for CALIPSO satellite LiDAR data with innovative features for spatial-temporal analysis, satellite path animation, and interactive data exploration.

## Overview

This application transforms CALIPSO (Cloud-Aerosol Lidar and Infrared Pathfinder Satellite Observations) satellite data into an interactive 3D/2D web experience. Built with React, Three.js, and deck.gl, it handles millions of points with advanced optimizations for browser-based rendering.

## Key Innovations

- **Position-Based Satellite Animation**: Synchronizes satellite movement with actual point cloud reveal using spatial-temporal indexing
- **TAI Time Handling**: Converts satellite GPS times from TAI (International Atomic Time) to human-readable UTC format
- **Spatial-Temporal Point Sorting**: Optimizes data organization for coherent visualization and progressive rendering
- **Dual Rendering Modes**: Seamless switching between 3D globe view (Three.js) and 2D map view (deck.gl)
- **Area of Interest (AOI) Selection**: Interactive polygon drawing on both globe and map for data subsetting
- **Progressive Point Cloud Rendering**: Curtain effect that reveals points chronologically during satellite animation
- **COPC Decimation Strategy**: Intelligent point reduction for handling datasets with 35M+ points

## Features

### Visualization Modes

- **3D Space View**: Interactive globe with orbital perspective
  - Satellite path animation with real-time position tracking
  - Progressive point cloud curtain effect
  - Dynamic GPS time display with TAI→UTC conversion
  - Spherical coordinate transformations

- **2D Map View**: High-performance map-based rendering
  - deck.gl ScatterplotLayer for millions of points
  - Flat map projections with zoom/pan
  - AOI polygon drawing

### Color Modes

- **Elevation**: Altitude-based gradient (customizable colormaps)
- **Intensity**: Backscatter intensity at 532nm wavelength
- **Classification**: LAS classification standard colors

### Colormaps

Six scientific colormaps available (when using elevation/intensity modes):
- Viridis
- Plasma
- Turbo
- Coolwarm
- Jet
- Grayscale

### Interactive Controls

- **Mouse Controls**:
  - Left Click + Drag: Rotate/Pan view
  - Right Click + Drag: Pan view
  - Scroll Wheel: Zoom in/out

- **Keyboard Shortcuts**:
  - `R`: Reset camera to default position

- **AOI Selection**:
  - Draw polygons on globe or map
  - Filter points within selected region
  - Generate scatter plots (altitude vs intensity)

- **Satellite Animation**:
  - Animate satellite path from first to last point
  - Real-time GPS time display (TAI→UTC converted)
  - Position tracking with compass directions (N/S/E/W)
  - Progressive point cloud reveal synchronized to satellite position

## Quick Start

### Prerequisites

- Node.js 16+ and npm
- Modern browser (Chrome, Firefox, Edge)
- COPC files in `/output/` directory

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

The application will open at http://localhost:3002

### Build for Production

```bash
npm run build
```

## Data Files

The viewer expects COPC files in the `/output/` directory (symlinked from `public/output`):

### Single File Mode
Individual satellite passes:
- `CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz` (193 MB, 35M points decimated to 5M)
- `CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz`
- `CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.copc.laz`
- And more...

### Tiled Mode
Latitude-based tiles for optimized loading:
- `CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_south.copc.laz` (lat -90° to -30°)
- Additional tiles available

**Note**: 'D' suffix = Descending pass (south to north), 'N' suffix = Nighttime/Ascending pass (north to south)

## Architecture

### Technology Stack

- **React 18**: Component framework with hooks
- **TypeScript**: Type safety and developer experience
- **Three.js**: 3D rendering for globe view
- **deck.gl**: High-performance 2D map rendering
- **loaders.gl**: COPC/LAZ file parsing with WASM decompression
- **Vite**: Fast build tool and HMR dev server

### Project Structure

```
viewer/
├── src/
│   ├── components/
│   │   ├── PointCloudViewer.tsx     # Main orchestrator
│   │   ├── GlobeViewer.tsx          # Three.js 3D globe
│   │   ├── DeckGLMapView.tsx        # deck.gl 2D map
│   │   ├── ControlPanel.tsx         # UI controls
│   │   ├── FileSelector.tsx         # File selection
│   │   └── AOIScatterPlot.tsx       # Scatter plot modal
│   ├── utils/
│   │   ├── copcLoader.ts            # COPC loading & TAI time
│   │   ├── coordinateConversion.ts  # Lat/lon/alt transforms
│   │   ├── colormaps.ts             # Color gradient functions
│   │   └── aoiSelector.ts           # Polygon filtering
│   ├── App.tsx                      # Root component & state
│   ├── main.tsx                     # Entry point
│   └── App.css                      # Global styles
├── public/
│   └── output/                      # Symlink to COPC files
├── docs/                            # Technical documentation
├── package.json
├── vite.config.ts
└── README.md
```

## Technical Documentation

For in-depth explanations of the innovations and strategies, see:

- [COPC Optimization](docs/COPC_OPTIMIZATION.md) - Point decimation, loading strategies, and memory management
- [Satellite Animation](docs/SATELLITE_ANIMATION.md) - Position-based animation synchronization
- [Spatial-Temporal Sorting](docs/SPATIAL_TEMPORAL_SORTING.md) - Data organization for coherent visualization
- [TAI Time Handling](docs/TAI_TIME_HANDLING.md) - GPS time parsing and conversion
- [Coordinate Systems](docs/COORDINATE_SYSTEMS.md) - Transformations between lat/lon/alt and 3D Cartesian
- [AOI Selection](docs/AOI_SELECTION.md) - Interactive polygon drawing and point filtering
- [Architecture](docs/ARCHITECTURE.md) - Component design, state management, and rendering pipeline

## Usage Guide

### Loading Data

1. Select **File Mode** (Single or Tiled)
2. Choose files from the file selector panel
3. Wait for loading progress to complete
4. Points will appear in the selected view mode

### Switching Views

Click the **View Mode** button to toggle between:
- 🌍 **Space View** (3D globe with satellite animation)
- 🗺️ **2D Map** (high-performance flat map)

### Changing Colors

1. Select **Color Mode** (Elevation, Intensity, or Classification)
2. If using Elevation or Intensity, choose a **Colormap**
3. Adjust **Point Size** slider for visibility

### Satellite Animation (Space View Only)

1. Load a single file (animation requires time-sorted data)
2. Ensure you're in **Space View** mode
3. Click **Animate Satellite Path** button
4. Watch the satellite move along the orbital path
5. Observe real-time updates:
   - **Time**: TAI GPS time converted to UTC
   - **Position**: Lat/lon with compass directions
   - **Point Cloud**: Progressive curtain reveal synchronized to satellite

### Area of Interest (AOI) Analysis

1. Click **Select AOI** button
2. Click points on the globe/map to draw a polygon
3. Click **Finish AOI** when complete
4. View **Points in AOI** count
5. Click **Plot** to generate altitude vs intensity scatter plot
6. Click **Clear AOI** to remove selection

## Performance Optimization

### Point Decimation

Large files (35M+ points) are automatically decimated to ~5M points:
- Target: 5,000,000 points
- Method: Keep every Nth point based on decimation factor
- Preserves spatial distribution and temporal ordering

### Loading Strategies

- **Tiled Mode**: Splits data by latitude bands for faster loading
- **Progressive Loading**: Shows loading percentage during file parsing
- **Memory Management**: Disposes geometries and materials when switching files

### Rendering Optimizations

- **Three.js PointsMaterial**: GPU-accelerated vertex rendering
- **deck.gl ScatterplotLayer**: WebGL instancing for 2D performance
- **DrawRange**: Progressive rendering during animation without re-creating geometry
- **Color Buffer Updates**: In-place updates when changing color modes

## Data Source

**CALIPSO Mission**:
- Joint NASA/CNES satellite (2006-present)
- Polar orbit at ~705 km altitude
- 532nm and 1064nm LiDAR wavelengths
- Level 1 products: calibrated backscatter profiles

**Data Pipeline**:
1. Download HDF4 files from NASA Earthdata
2. Convert to LAZ using custom Python scripts
3. Sort points spatially and temporally
4. Create COPC format with `pdal translate`
5. Optional: Create latitude-based tiles

**Sample Date**: June 30, 2023

## Troubleshooting

### Files Won't Load

- Verify COPC files exist in `/output/` directory
- Check browser console for specific errors
- Ensure file paths in `App.tsx` match your file names
- Try single file mode first before tiled

### Slow Performance

- Use **Tiled Mode** instead of single large files
- Reduce **Point Size** to minimum
- Close other browser tabs/applications
- Try **2D Map View** for better performance
- Ensure you're using a modern GPU

### Satellite Animation Issues

- Only works in **Space View** (not 2D map)
- Requires **single file** mode (not tiled)
- If satellite moves incorrectly, check console for errors
- Animation uses spatial-temporal sorted data

### Points Look Wrong

- Try different **Color Modes** (Elevation, Intensity, Classification)
- Experiment with different **Colormaps**
- Press `R` to reset camera
- Check that data range displays valid values
- Verify COPC files were converted correctly from HDF

### AOI Selection Not Working

- Ensure you're in the correct view mode
- Click **Select AOI** before drawing
- Need at least 3 points to form a polygon
- Click **Finish AOI** after drawing
- Check console for polygon validation errors

## Development

### Adding New COPC Files

Edit `src/App.tsx`:

```typescript
const SINGLE_FILES = [
  '/output/your-new-file.copc.laz',
  // Add more files here
]

const TILED_FILES = [
  '/output/tiled/your-tile-1.copc.laz',
  '/output/tiled/your-tile-2.copc.laz',
  // Add more tiles here
]
```

### Customizing Colormaps

Edit `src/utils/colormaps.ts` to add new color gradients:

```typescript
export function getColormap(value: number, colormap: Colormap): [number, number, number] {
  // Add new colormap case
  // Return [r, g, b] values (0-1 range)
}
```

### Modifying Point Decimation

Edit `src/utils/copcLoader.ts`:

```typescript
const TARGET_POINT_COUNT = 5_000_000  // Adjust this value
```

### Adjusting Animation Speed

Edit `src/components/GlobeViewer.tsx`:

```typescript
const animationDuration = 20000  // Duration in milliseconds
```

## Browser Compatibility

Tested and optimized for:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Edge 90+
- ✅ Safari 14+ (limited WebGL2 features)

Requires:
- WebGL 2.0 support
- ES2020 features
- Minimum 4GB RAM recommended

## Known Limitations

- Maximum tested file size: 193 MB (35M points → decimated to 5M)
- Satellite animation only works with single files (not tiled)
- AOI polygon drawing requires manual vertex clicking (no freehand)
- TAI time conversion assumes no leap seconds after 2017
- Mobile devices may have performance issues with large datasets

## Future Enhancements

- [ ] Add vertical profile visualization
- [ ] Export AOI-filtered data to CSV
- [ ] Support for classification editing
- [ ] Time-series animation for multiple passes
- [ ] Cloud/Aerosol layer detection visualization
- [ ] WebGL2 compute shaders for color calculations
- [ ] Streaming COPC support (read without full download)

## License

This project is for educational and research purposes. CALIPSO data is publicly available from NASA Earthdata.

## Related Resources

- **COPC Specification**: https://copc.io/
- **CALIPSO Mission**: https://www-calipso.larc.nasa.gov/
- **NASA Earthdata**: https://search.earthdata.nasa.gov/
- **Three.js Docs**: https://threejs.org/docs/
- **deck.gl Docs**: https://deck.gl/
- **loaders.gl**: https://loaders.gl/
- **PDAL (Point Data Abstraction Library)**: https://pdal.io/

## Acknowledgments

Data courtesy of NASA Langley Research Center Atmospheric Science Data Center.

Built with:
- React + TypeScript
- Three.js for 3D rendering
- deck.gl for 2D rendering
- loaders.gl for COPC parsing
- laz-perf (WASM) for LAZ decompression
