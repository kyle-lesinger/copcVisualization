# COPC Tiling for CALIPSO Data

## The Problem: Oversized COPC Cubes

When converting global satellite LiDAR data (like CALIPSO) to COPC format, PDAL's COPC writer calculates a single octree cube to contain all points. This cube uses the largest data dimension as the basis for all axes.

### Example from CALIPSO Data:

**Data Bounds:**
- Longitude (X): -180° to +180° (360° span)
- Latitude (Y): -55° to +82° (137° span)
- Altitude (Z): 1.8 to 40 km (38.2 km span)

**PDAL's COPC Cube Calculation:**
- Uses the largest dimension (360° longitude) to set cube halfsize
- Results in: `halfsize: 179.997°`
- Cube spans:
  - Y: -55° to **305°** (should be -55° to 82°) ❌
  - Z: 1.8 to **361.8 km** (should be 1.8 to 40 km) ❌

This creates "points out of bounds" errors in 107+ octree nodes and may prevent COPC viewers from loading the file.

## The Solution: Latitude-Based Tiling

Split data into multiple latitude bands to reduce the aspect ratio and create properly-sized COPC cubes.

### Why Latitude Instead of Longitude?

CALIPSO orbital tracks:
- **Longitude**: Spans entire globe (360°) in single pass, often crossing antimeridian
- **Latitude**: Gradual progression from -82° to +82°, easier to split into bands

Splitting by latitude creates better-proportioned tiles that work well with COPC's cube calculation.

## Implementation

### Quick Start

Use the tiling script to create 4 latitude-based COPC tiles:

```bash
python convert_tiled.py data/input.hdf output/tiled
```

This creates:
- `*_tile_south.copc.laz` (lat -90° to -30°)
- `*_tile_south_mid.copc.laz` (lat -30° to 0°)
- `*_tile_north_mid.copc.laz` (lat 0° to 30°)
- `*_tile_north.copc.laz` (lat 30° to 90°)

### Customizing Tile Boundaries

Edit `convert_tiled.py` to adjust latitude bands:

```python
tiles = [
    {'name': 'south', 'lat_min': -90, 'lat_max': -30},
    {'name': 'south_mid', 'lat_min': -30, 'lat_max': 0},
    {'name': 'north_mid', 'lat_min': 0, 'lat_max': 30},
    {'name': 'north', 'lat_min': 30, 'lat_max': 90}
]
```

For example, create 6 tiles with 30° bands:
```python
tiles = [
    {'name': 'lat_n60', 'lat_min': -90, 'lat_max': -60},
    {'name': 'lat_n30', 'lat_min': -60, 'lat_max': -30},
    {'name': 'lat_0', 'lat_min': -30, 'lat_max': 0},
    {'name': 'lat_p30', 'lat_min': 0, 'lat_max': 30},
    {'name': 'lat_p60', 'lat_min': 30, 'lat_max': 60},
    {'name': 'lat_p90', 'lat_min': 60, 'lat_max': 90}
]
```

### Manual Tiling with calipso_to_las.py

You can also manually create filtered LAS files and convert them:

```python
from calipso_to_las import convert_calipso_to_las

# Create LAS for specific latitude range
convert_calipso_to_las(
    'input.hdf',
    'output_north.las',
    lat_min=0,
    lat_max=90
)
```

Then convert to COPC using PDAL:
```bash
pdal pipeline las_to_copc.json --readers.las.filename=output_north.las \
    --writers.copc.filename=output_north.copc.laz
```

## Results: Tiled vs Non-Tiled

### Non-Tiled (Single File):
- **File size**: 193 MB (35M points)
- **COPC cube halfsize**: 179.997°
- **Status**: Points out of bounds in 107 nodes ❌
- **Viewer compatibility**: May fail to load

### Tiled (4 Files):
- **Total size**: 191 MB (35M points across 4 files)
- **COPC cube halfsize**: 15-30° per tile
- **Status**: Properly bounded cubes ✅
- **Viewer compatibility**: Expected to load correctly

## Tradeoffs

### Single File (No Tiling)
**Pros:**
- Single file, easier to manage
- Maintains original data organization
- Simpler workflow

**Cons:**
- COPC cube bounds issue (points out of bounds)
- May not load in COPC viewers
- Inefficient spatial indexing for thin tracks

### Tiled Files
**Pros:**
- Proper COPC cube sizing
- Works with COPC viewers
- Better spatial indexing per tile
- Smaller individual files (easier to transfer/process)

**Cons:**
- Multiple files to manage
- Need to load multiple tiles to see full dataset
- More complex processing workflow

## When to Use Tiling

**Use tiling if:**
- Files won't load in COPC viewers
- Data spans large geographic areas (global, continental)
- You need efficient spatial queries by region
- Working with web-based 3D viewers that prefer smaller tiles

**Skip tiling if:**
- Data has small geographic extent (local area)
- Using desktop GIS/point cloud software that handles large files well
- File management complexity is a concern
- COPC validation issues are not critical for your workflow

## Technical Details

### PDAL COPC Cube Calculation

PDAL's `writers.copc` automatically calculates the octree cube to contain all points. The algorithm:

1. Finds the bounding box of all input points
2. Calculates the cube center as the midpoint of the bounding box
3. Sets the halfsize to the maximum distance from center to any bounding box corner
4. This ensures all points fit within the cube

For data with extreme aspect ratios (like satellite tracks: 360° × 137° × 0.04°), this creates oversized cubes where the Z dimension is vastly larger than the actual data range.

### Alternative Formats

If COPC tiling proves too complex, consider:

- **EPT (Entwine Point Tiles)**: Better suited for large geographic extents
- **3D Tiles**: Optimized for web visualization
- **Simple LAZ tiles**: Create geographic tiles without octree structure

These can be generated using tools like Entwine or PDAL's `writers.ept` filter.

## Files

- `calipso_to_las.py` - Main conversion script with filtering support
- `convert_tiled.py` - Automated latitude-based tiling
- `las_to_copc.json` - PDAL pipeline for single-file COPC conversion
- `convert_all.sh` - Batch process multiple files (single-file approach)
