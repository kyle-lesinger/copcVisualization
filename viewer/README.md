# CALIPSO COPC Viewer

A Three.js-based web application for visualizing CALIPSO satellite LiDAR data in Cloud Optimized Point Cloud (COPC) format.

## Features

- **3D Point Cloud Visualization**: Renders millions of points using Three.js
- **Multiple File Support**: Load single COPC files or tiled versions
- **Interactive Controls**:
  - Orbit, pan, and zoom controls
  - Keyboard shortcuts (R to reset camera)
- **Color Modes**:
  - Elevation (altitude-based gradient)
  - Intensity (backscatter 532nm)
  - Classification (LAS classification colors)
- **Adjustable Point Size**: Real-time point size control
- **Performance**: Handles 35+ million points efficiently

## Quick Start

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

The application will open at http://localhost:3002

### Build for Production

```bash
npm run build
```

## Data Files

The viewer expects COPC files in the `../output/` directory:

### Single File Mode
- `../output/test_fixed.copc.laz` (193 MB, 35M points)

### Tiled Mode (4 files)
- `../output/tiled/*_tile_south.copc.laz` (lat -90° to -30°)
- `../output/tiled/*_tile_south_mid.copc.laz` (lat -30° to 0°)
- `../output/tiled/*_tile_north_mid.copc.laz` (lat 0° to 30°)
- `../output/tiled/*_tile_north.copc.laz` (lat 30° to 90°)

## Controls

### Mouse
- **Left Click + Drag**: Rotate view
- **Right Click + Drag**: Pan view
- **Scroll Wheel**: Zoom in/out

### Keyboard
- **R**: Reset camera to default position

## Architecture

### Technology Stack
- **React 18**: UI framework
- **TypeScript**: Type safety
- **Three.js**: 3D rendering
- **loaders.gl**: COPC/LAZ file loading
- **Vite**: Build tool and dev server

### Project Structure
```
viewer/
├── src/
│   ├── components/
│   │   ├── PointCloudViewer.tsx    # Main 3D viewer
│   │   ├── FileSelector.tsx        # File selection UI
│   │   └── ControlPanel.tsx        # Display settings
│   ├── utils/
│   │   └── copcLoader.ts           # COPC loading utilities
│   ├── App.tsx                     # Main application
│   └── main.tsx                    # Entry point
├── package.json
├── vite.config.ts
└── README.md
```

## Color Modes

### Elevation
Colors points based on altitude (Z coordinate):
- Blue: Low elevation
- Green: Mid elevation
- Red: High elevation

### Intensity
Grayscale based on backscatter intensity (532nm wavelength):
- Dark: Low intensity
- Bright: High intensity

### Classification
Standard LAS classification colors:
- Gray: Unclassified
- Brown: Ground
- Green: Vegetation (low/medium/high)
- Red: Buildings
- Blue: Water

## Performance Tips

1. **Tiled Mode**: Use tiled files for better performance (4 smaller files load faster than 1 large file)
2. **Point Size**: Reduce point size if rendering is slow
3. **File Selection**: Uncheck files you don't need to visualize

## Data Source

CALIPSO (Cloud-Aerosol Lidar and Infrared Pathfinder Satellite Observations):
- NASA/CNES satellite mission
- Level 1 LiDAR backscatter data
- Converted from HDF4 to COPC format
- Date: June 30, 2023

## Troubleshooting

### Files Won't Load
- Ensure COPC files exist in `../output/` directory
- Check browser console for errors
- Verify file paths in `App.tsx`

### Slow Performance
- Try tiled mode instead of single file
- Reduce point size
- Close other browser tabs
- Use a modern browser (Chrome, Firefox, Edge)

### Points Look Wrong
- Try different color modes
- Reset camera with 'R' key
- Check that COPC files were converted correctly

## Development

### Adding New COPC Files

Edit `src/App.tsx` and update the file lists:

```typescript
const SINGLE_FILES = [
  '../output/your-file.copc.laz'
]

const TILED_FILES = [
  '../output/tiled/tile1.copc.laz',
  '../output/tiled/tile2.copc.laz',
  // ...
]
```

### Customizing Colors

Edit `src/utils/copcLoader.ts` to modify color gradients:

```typescript
// Example: Change elevation gradient
export function computeElevationColors(...) {
  // Modify RGB calculations here
}
```

## License

This project is for educational and research purposes.

## Related

- **COPC Specification**: https://copc.io/
- **CALIPSO Mission**: https://www-calipso.larc.nasa.gov/
- **Three.js Documentation**: https://threejs.org/docs/
- **loaders.gl**: https://loaders.gl/

## Credits

Built with:
- React + TypeScript
- Three.js for 3D rendering
- loaders.gl for COPC parsing
- OrbitControls for camera interaction
