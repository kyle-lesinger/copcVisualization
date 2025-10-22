#!/usr/bin/env python3
"""
Convert CALIPSO HDF to COPC with longitude-based tiling.

This splits the global data into 4 longitude tiles to avoid COPC cube calculation issues.
"""

import sys
import subprocess
from pathlib import Path
from calipso_to_las import convert_calipso_to_las

def convert_with_tiles(hdf_path, output_dir=None, tile_by='latitude'):
    """
    Convert CALIPSO HDF to multiple COPC tiles.

    Args:
        hdf_path: Path to input HDF file
        output_dir: Output directory for tiles
        tile_by: 'latitude' (default) or 'longitude'
    """
    hdf_path = Path(hdf_path)

    if output_dir is None:
        output_dir = Path('output')
    else:
        output_dir = Path(output_dir)

    output_dir.mkdir(exist_ok=True)

    if tile_by == 'latitude':
        # Define latitude tiles (4 tiles spanning typical CALIPSO range)
        # CALIPSO covers approximately -82° to +82° latitude
        tiles = [
            {'name': 'south', 'lat_min': -90, 'lat_max': -30},
            {'name': 'south_mid', 'lat_min': -30, 'lat_max': 0},
            {'name': 'north_mid', 'lat_min': 0, 'lat_max': 30},
            {'name': 'north', 'lat_min': 30, 'lat_max': 90}
        ]
        tile_desc = "latitude"
    else:
        # Define longitude tiles (4 tiles of 90° each)
        tiles = [
            {'name': 'west', 'lon_min': -180, 'lon_max': -90},
            {'name': 'central_west', 'lon_min': -90, 'lon_max': 0},
            {'name': 'central_east', 'lon_min': 0, 'lon_max': 90},
            {'name': 'east', 'lon_min': 90, 'lon_max': 180}
        ]
        tile_desc = "longitude"

    base_name = hdf_path.stem

    print(f"Converting {hdf_path.name} to tiled COPC files...")
    print(f"Output directory: {output_dir}")
    print(f"Creating {len(tiles)} {tile_desc} tiles\n")

    for tile in tiles:
        tile_name = f"{base_name}_tile_{tile['name']}"
        las_path = output_dir / f"{tile_name}.las"
        copc_path = output_dir / f"{tile_name}.copc.laz"

        # Determine filter description and parameters
        if 'lat_min' in tile:
            filter_desc = f"lat: {tile['lat_min']}° to {tile['lat_max']}°"
            filter_kwargs = {'lat_min': tile['lat_min'], 'lat_max': tile['lat_max']}
        else:
            filter_desc = f"lon: {tile['lon_min']}° to {tile['lon_max']}°"
            filter_kwargs = {'lon_min': tile['lon_min'], 'lon_max': tile['lon_max']}

        print(f"\n{'='*80}")
        print(f"Processing tile: {tile['name']} ({filter_desc})")
        print(f"{'='*80}")

        # Step 1: Convert HDF to LAS with spatial filter
        print(f"\nStep 1: Converting to LAS with spatial filter...")
        try:
            convert_calipso_to_las(
                hdf_path,
                las_path,
                **filter_kwargs
            )
            print(f"✓ Created {las_path}")
        except Exception as e:
            print(f"✗ Error creating LAS: {e}")
            continue

        # Step 2: Convert LAS to COPC using PDAL
        print(f"\nStep 2: Converting LAS to COPC...")
        try:
            pipeline = {
                "pipeline": [
                    {
                        "type": "readers.las",
                        "filename": str(las_path)
                    },
                    {
                        "type": "filters.stats",
                        "dimensions": "X,Y,Z,Intensity"
                    },
                    {
                        "type": "writers.copc",
                        "filename": str(copc_path),
                        "forward": "all",
                        "a_srs": "EPSG:4326",
                        "scale_x": 0.0001,
                        "scale_y": 0.0001,
                        "scale_z": 0.001,
                        "offset_x": "auto",
                        "offset_y": "auto",
                        "offset_z": "auto"
                    }
                ]
            }

            import json
            pipeline_json = json.dumps(pipeline)

            # Use the correct pdal from conda environment
            pdal_path = '/opt/anaconda3/envs/pdal/bin/pdal'
            result = subprocess.run(
                [pdal_path, 'pipeline', '--stdin'],
                input=pipeline_json.encode(),
                capture_output=True,
                check=True
            )

            print(f"✓ Created {copc_path}")

            # Get file size
            size_mb = copc_path.stat().st_size / (1024 * 1024)
            print(f"  File size: {size_mb:.1f} MB")

        except subprocess.CalledProcessError as e:
            print(f"✗ Error converting to COPC: {e}")
            print(f"  stderr: {e.stderr.decode()}")
            continue

    print(f"\n{'='*80}")
    print("Conversion complete!")
    print(f"Output files in: {output_dir}")
    print(f"{'='*80}\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert_tiled.py <input.hdf> [output_dir]")
        print("\nThis script creates 4 latitude-based COPC tiles (default):")
        print("  - south: -90° to -30°")
        print("  - south_mid: -30° to 0°")
        print("  - north_mid: 0° to 30°")
        print("  - north: 30° to 90°")
        print("\nLatitude tiling works better for satellite LiDAR orbital tracks.")
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'output'

    try:
        convert_with_tiles(input_file, output_dir, tile_by='latitude')
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
