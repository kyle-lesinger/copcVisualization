#!/usr/bin/env python3
"""
Convert CALIPSO HDF files to Potree format via LAS and COPC.

Pipeline: HDF → LAS → COPC → Potree

This script extends the existing conversion pipeline to generate Potree-formatted
point clouds suitable for web-based 3D visualization.
"""

import sys
import subprocess
import json
import shutil
from pathlib import Path
from calipso_to_las import convert_calipso_to_las


def check_potree_converter(potree_path=None):
    """
    Check if PotreeConverter is installed and accessible.

    Args:
        potree_path: Optional explicit path to PotreeConverter executable

    Returns:
        Path to PotreeConverter executable or None if not found
    """
    if potree_path:
        potree_exec = Path(potree_path)
        if potree_exec.exists():
            return potree_exec
        else:
            print(f"✗ PotreeConverter not found at specified path: {potree_path}")
            return None

    # Check if PotreeConverter is in PATH
    potree_exec = shutil.which('PotreeConverter')
    if potree_exec:
        return Path(potree_exec)

    # Check common installation locations
    common_paths = [
        '/usr/local/bin/PotreeConverter',
        '/usr/bin/PotreeConverter',
        Path.home() / 'PotreeConverter' / 'build' / 'PotreeConverter',
        Path.home() / 'bin' / 'PotreeConverter',
    ]

    for path in common_paths:
        if Path(path).exists():
            return Path(path)

    return None


def print_installation_instructions():
    """Print helpful installation instructions for PotreeConverter."""
    print("\n" + "="*80)
    print("PotreeConverter Installation Instructions")
    print("="*80)
    print("\nPotreeConverter is required but not found. Please install it:")
    print("\n1. From Source (Recommended):")
    print("   git clone https://github.com/potree/PotreeConverter.git")
    print("   cd PotreeConverter")
    print("   mkdir build && cd build")
    print("   cmake ../")
    print("   make")
    print("\n2. Add to PATH or specify location:")
    print("   - Add PotreeConverter to your PATH, or")
    print("   - Use --potree-path flag to specify the executable location")
    print("\n3. Verify installation:")
    print("   PotreeConverter --help")
    print("\nFor more details, visit: https://github.com/potree/PotreeConverter")
    print("="*80 + "\n")


def convert_las_to_copc(las_path, copc_path, pdal_path='/opt/anaconda3/envs/pdal/bin/pdal'):
    """
    Convert LAS file to COPC format using PDAL.

    Args:
        las_path: Path to input LAS file
        copc_path: Path for output COPC file
        pdal_path: Path to PDAL executable
    """
    print(f"\nConverting LAS to COPC...")
    print(f"  Input: {las_path}")
    print(f"  Output: {copc_path}")

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

    pipeline_json = json.dumps(pipeline)

    try:
        result = subprocess.run(
            [pdal_path, 'pipeline', '--stdin'],
            input=pipeline_json.encode(),
            capture_output=True,
            check=True
        )

        size_mb = copc_path.stat().st_size / (1024 * 1024)
        print(f"✓ Created COPC file: {copc_path}")
        print(f"  File size: {size_mb:.1f} MB")

    except subprocess.CalledProcessError as e:
        print(f"✗ Error converting to COPC: {e}")
        print(f"  stderr: {e.stderr.decode()}")
        raise


def convert_copc_to_potree(copc_path, potree_output_dir, potree_converter_path):
    """
    Convert COPC file to Potree format.

    Args:
        copc_path: Path to input COPC file
        potree_output_dir: Directory for Potree output
        potree_converter_path: Path to PotreeConverter executable
    """
    print(f"\nConverting COPC to Potree format...")
    print(f"  Input: {copc_path}")
    print(f"  Output directory: {potree_output_dir}")

    # Create output directory if it doesn't exist
    potree_output_dir.mkdir(parents=True, exist_ok=True)

    # Build PotreeConverter command
    # Basic usage: PotreeConverter <input> -o <outputDir>
    cmd = [
        str(potree_converter_path),
        str(copc_path),
        '-o', str(potree_output_dir)
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            text=True
        )

        print(f"✓ Created Potree format files in: {potree_output_dir}")
        if result.stdout:
            print(f"  PotreeConverter output:\n{result.stdout}")

    except subprocess.CalledProcessError as e:
        print(f"✗ Error converting to Potree: {e}")
        if e.stderr:
            print(f"  stderr: {e.stderr}")
        raise


def convert_hdf_to_potree(hdf_path, output_dir=None, potree_converter_path=None,
                          pdal_path='/opt/anaconda3/envs/pdal/bin/pdal',
                          keep_intermediate=False):
    """
    Complete pipeline: HDF → LAS → COPC → Potree.

    Args:
        hdf_path: Path to input HDF file
        output_dir: Base output directory (default: 'potree_data')
        potree_converter_path: Optional path to PotreeConverter executable
        pdal_path: Path to PDAL executable
        keep_intermediate: If True, keep LAS and COPC files after conversion

    Returns:
        Path to Potree output directory
    """
    hdf_path = Path(hdf_path)

    # Check PotreeConverter availability
    potree_exec = check_potree_converter(potree_converter_path)
    if not potree_exec:
        print_installation_instructions()
        raise RuntimeError("PotreeConverter not found. Please install and try again.")

    print(f"✓ Found PotreeConverter: {potree_exec}")

    # Set up output directory structure
    if output_dir is None:
        output_dir = Path('potree_data')
    else:
        output_dir = Path(output_dir)

    output_dir.mkdir(exist_ok=True)

    base_name = hdf_path.stem
    las_path = output_dir / f"{base_name}.las"
    copc_path = output_dir / f"{base_name}.copc.laz"
    potree_output = output_dir / base_name

    print("\n" + "="*80)
    print(f"Converting {hdf_path.name} to Potree format")
    print("="*80)
    print(f"Pipeline: HDF → LAS → COPC → Potree")
    print(f"Output directory: {output_dir}")
    print()

    try:
        # Step 1: HDF → LAS
        print("Step 1/3: Converting HDF to LAS...")
        convert_calipso_to_las(hdf_path, las_path)
        print(f"✓ Created LAS file: {las_path}")

        # Step 2: LAS → COPC
        print("\nStep 2/3: Converting LAS to COPC...")
        convert_las_to_copc(las_path, copc_path, pdal_path)

        # Step 3: COPC → Potree
        print("\nStep 3/3: Converting COPC to Potree...")
        convert_copc_to_potree(copc_path, potree_output, potree_exec)

        # Clean up intermediate files if requested
        if not keep_intermediate:
            print("\nCleaning up intermediate files...")
            if las_path.exists():
                las_path.unlink()
                print(f"  Removed: {las_path}")
            if copc_path.exists():
                copc_path.unlink()
                print(f"  Removed: {copc_path}")

        print("\n" + "="*80)
        print("✓ Conversion complete!")
        print(f"Potree output: {potree_output}")
        print("="*80 + "\n")

        return potree_output

    except Exception as e:
        print(f"\n✗ Conversion failed: {e}")
        raise


def main():
    """Main entry point with command-line argument parsing."""
    import argparse

    parser = argparse.ArgumentParser(
        description='Convert CALIPSO HDF files to Potree format',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic conversion
  python convert_to_potree.py input.hdf

  # Specify output directory
  python convert_to_potree.py input.hdf -o my_potree_data

  # Keep intermediate LAS and COPC files
  python convert_to_potree.py input.hdf --keep-intermediate

  # Specify PotreeConverter location
  python convert_to_potree.py input.hdf --potree-path /path/to/PotreeConverter
"""
    )

    parser.add_argument('input', help='Input HDF file')
    parser.add_argument('-o', '--output-dir', default='potree_data',
                       help='Output directory (default: potree_data)')
    parser.add_argument('--potree-path',
                       help='Path to PotreeConverter executable')
    parser.add_argument('--pdal-path', default='/opt/anaconda3/envs/pdal/bin/pdal',
                       help='Path to PDAL executable')
    parser.add_argument('--keep-intermediate', action='store_true',
                       help='Keep intermediate LAS and COPC files')

    args = parser.parse_args()

    try:
        convert_hdf_to_potree(
            args.input,
            args.output_dir,
            args.potree_path,
            args.pdal_path,
            args.keep_intermediate
        )
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
