#!/usr/bin/env python3
"""
Batch convert all COPC files to Potree format

This script finds all .copc.laz files in a directory and converts them to Potree format

Usage:
    python convert_all_copc_to_potree.py <copc_dir> <potree_output_dir>

Example:
    python convert_all_copc_to_potree.py copc/ public/potree_data/
"""

import sys
import os
import subprocess
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

def convert_single_file(args):
    """Convert a single COPC file to Potree (for parallel execution)"""
    copc_file, output_base_dir = args

    # Create output directory based on input filename
    stem = copc_file.stem.replace('.copc', '')
    output_dir = output_base_dir / stem

    print(f"\n{'='*60}")
    print(f"Converting: {copc_file.name}")
    print(f"Output: {output_dir}")
    print(f"{'='*60}")

    # Run the conversion script
    cmd = ['python3', 'convert_copc_to_potree.py', str(copc_file), str(output_dir)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        print(result.stdout)
        return (copc_file.name, True, "Success")
    except subprocess.CalledProcessError as e:
        error_msg = f"Failed: {e.stderr}"
        print(f"❌ {error_msg}")
        return (copc_file.name, False, error_msg)

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    copc_dir = Path(sys.argv[1])
    output_base_dir = Path(sys.argv[2])

    # Validate input directory
    if not copc_dir.exists():
        print(f"❌ Input directory not found: {copc_dir}")
        sys.exit(1)

    # Find all COPC files
    copc_files = list(copc_dir.glob("*.copc.laz"))

    if not copc_files:
        print(f"❌ No .copc.laz files found in {copc_dir}")
        sys.exit(1)

    print(f"Found {len(copc_files)} COPC file(s) to convert:")
    for f in copc_files:
        print(f"  - {f.name}")

    # Create output directory
    output_base_dir.mkdir(parents=True, exist_ok=True)

    # Ask for confirmation
    response = input(f"\nConvert {len(copc_files)} file(s)? [y/N]: ")
    if response.lower() != 'y':
        print("Aborted by user")
        sys.exit(0)

    # Process files (can be done in parallel or sequentially)
    # Set max_workers=1 for sequential, or higher for parallel
    max_workers = 1  # Sequential processing (safer, easier to debug)

    print(f"\n🚀 Starting conversion (max_workers={max_workers})...")

    results = []
    args_list = [(f, output_base_dir) for f in copc_files]

    if max_workers == 1:
        # Sequential processing
        for args in args_list:
            result = convert_single_file(args)
            results.append(result)
    else:
        # Parallel processing
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(convert_single_file, args) for args in args_list]

            for future in as_completed(futures):
                result = future.result()
                results.append(result)

    # Summary
    print(f"\n{'='*60}")
    print("CONVERSION SUMMARY")
    print(f"{'='*60}")

    successes = [r for r in results if r[1]]
    failures = [r for r in results if not r[1]]

    print(f"✅ Successful: {len(successes)}/{len(results)}")
    for name, _, _ in successes:
        print(f"   - {name}")

    if failures:
        print(f"\n❌ Failed: {len(failures)}/{len(results)}")
        for name, _, error in failures:
            print(f"   - {name}: {error}")

    print(f"\n📂 Output directory: {output_base_dir}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
