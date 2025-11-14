#!/usr/bin/env python3
"""
Convert COPC files (EPSG:3857 Web Mercator) to Potree format (EPSG:4326 WGS84)

This script:
1. Reprojects COPC from EPSG:3857 (meters) to EPSG:4326 (degrees) using PDAL
2. Converts the reprojected LAS to Potree format using PotreeConverter

Usage:
    python convert_copc_to_potree.py <input_copc_file> <output_potree_dir>

Example:
    python convert_copc_to_potree.py calipso_2023-06-30_0.copc.laz potree_output/
"""

import json
import subprocess
import sys
import os
import tempfile
from pathlib import Path

def reproject_copc_to_las(input_copc: str, output_las: str):
    """
    Reproject COPC from EPSG:3857 (Web Mercator) to EPSG:4326 (WGS84) using PDAL

    Args:
        input_copc: Path to input COPC file (in EPSG:3857)
        output_las: Path to output LAS file (will be in EPSG:4326)
    """
    print(f"📍 Reprojecting {input_copc} from EPSG:3857 to EPSG:4326...")

    # PDAL pipeline configuration
    pipeline = {
        "pipeline": [
            {
                "type": "readers.copc",
                "filename": input_copc
            },
            {
                "type": "filters.reprojection",
                "in_srs": "EPSG:3857",
                "out_srs": "EPSG:4326"
            },
            {
                "type": "writers.las",
                "filename": output_las,
                # Critical: Use high precision for decimal degrees
                "scale_x": "0.0000001",  # ~1cm precision at equator
                "scale_y": "0.0000001",  # ~1cm precision
                "scale_z": "0.001",      # 1mm altitude precision
                "offset_x": "auto",
                "offset_y": "auto",
                "offset_z": "auto",
                "a_srs": "EPSG:4326"
            }
        ]
    }

    # Write pipeline to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(pipeline, f, indent=2)
        pipeline_file = f.name

    try:
        # Run PDAL (use full path to pdal binary)
        pdal_bin = '/opt/anaconda3/envs/pdal/bin/pdal'
        result = subprocess.run(
            [pdal_bin, 'pipeline', pipeline_file],
            capture_output=True,
            text=True,
            check=True
        )
        print(f"✅ Reprojection complete: {output_las}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ PDAL reprojection failed:")
        print(f"  stdout: {e.stdout}")
        print(f"  stderr: {e.stderr}")
        return False
    finally:
        os.unlink(pipeline_file)

def convert_las_to_potree(input_las: str, output_dir: str):
    """
    Convert LAS file to Potree format using PotreeConverter

    Args:
        input_las: Path to input LAS file (in EPSG:4326)
        output_dir: Directory for Potree output
    """
    print(f"🌲 Converting {input_las} to Potree format...")

    # PotreeConverter command (use full path)
    # --source specifies input projection (WGS84)
    potree_converter = '/Users/klesinger/github/deckGL/callipsoVizCOPC/PotreeConverter/build/PotreeConverter'
    cmd = [
        potree_converter,
        input_las,
        '-o', output_dir,
        '--overwrite',
        '--generate-page', 'index',
        # Specify WGS84 projection
        '--projection', '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'
    ]

    print(f"Running: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        print(f"✅ Potree conversion complete: {output_dir}")
        print(f"\nOutput:")
        print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ PotreeConverter failed:")
        print(f"  stdout: {e.stdout}")
        print(f"  stderr: {e.stderr}")
        return False
    except FileNotFoundError:
        print("❌ PotreeConverter not found!")
        print("Please install PotreeConverter: https://github.com/potree/PotreeConverter")
        return False

def verify_potree_metadata(output_dir: str):
    """
    Verify the generated Potree metadata has correct bounds
    """
    metadata_path = Path(output_dir) / "metadata.json"

    if not metadata_path.exists():
        print(f"⚠️  Warning: metadata.json not found at {metadata_path}")
        return False

    with open(metadata_path) as f:
        metadata = json.load(f)

    bbox = metadata.get('boundingBox', {})
    min_coords = bbox.get('min', [])
    max_coords = bbox.get('max', [])

    print(f"\n📊 Potree Metadata Verification:")
    print(f"  Version: {metadata.get('version', 'unknown')}")
    print(f"  Points: {metadata.get('points', 0):,}")
    print(f"  Bounds:")

    if len(min_coords) >= 3 and len(max_coords) >= 3:
        print(f"    Longitude: {min_coords[0]:.6f}° to {max_coords[0]:.6f}°")
        print(f"    Latitude:  {min_coords[1]:.6f}° to {max_coords[1]:.6f}°")
        print(f"    Altitude:  {min_coords[2]:.3f} to {max_coords[2]:.3f} km")

        # Sanity check
        if abs(min_coords[0]) > 180 or abs(max_coords[0]) > 180:
            print(f"  ⚠️  WARNING: Longitude outside valid range [-180, 180]!")
            return False
        if abs(min_coords[1]) > 90 or abs(max_coords[1]) > 90:
            print(f"  ⚠️  WARNING: Latitude outside valid range [-90, 90]!")
            return False
        if max_coords[2] > 100:
            print(f"  ⚠️  WARNING: Altitude > 100 km (suspicious for CALIPSO data)")
            return False

        print(f"  ✅ Bounds look reasonable!")
        return True
    else:
        print(f"  ⚠️  Could not read bounds from metadata")
        return False

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    input_copc = sys.argv[1]
    output_potree_dir = sys.argv[2]

    # Validate input
    if not os.path.exists(input_copc):
        print(f"❌ Input file not found: {input_copc}")
        sys.exit(1)

    # Create output directory
    Path(output_potree_dir).mkdir(parents=True, exist_ok=True)

    # Create temp LAS file
    temp_las = tempfile.NamedTemporaryFile(suffix='.las', delete=False).name

    try:
        # Step 1: Reproject COPC → LAS
        if not reproject_copc_to_las(input_copc, temp_las):
            print("❌ Reprojection failed, aborting")
            sys.exit(1)

        # Step 2: Convert LAS → Potree
        if not convert_las_to_potree(temp_las, output_potree_dir):
            print("❌ Potree conversion failed, aborting")
            sys.exit(1)

        # Step 3: Verify output
        verify_potree_metadata(output_potree_dir)

        print(f"\n🎉 Success! Potree data created at: {output_potree_dir}")
        print(f"   Open {output_potree_dir}/index.html to view")

    finally:
        # Cleanup temp file
        if os.path.exists(temp_las):
            os.unlink(temp_las)
            print(f"🧹 Cleaned up temp file: {temp_las}")

if __name__ == "__main__":
    main()
