#!/usr/bin/env python3
"""
Explore the structure of CALIPSO HDF4 files to understand available datasets.
"""

from pyhdf.SD import SD, SDC
import sys

def explore_hdf4(filepath):
    """Explore the structure of an HDF4 file."""
    print(f"Exploring HDF4 file: {filepath}")
    print("=" * 80)

    # Open the HDF file
    hdf = SD(filepath, SDC.READ)

    # List all datasets
    datasets = hdf.datasets()
    print(f"\nFound {len(datasets)} datasets:\n")

    for dataset_name, info in sorted(datasets.items()):
        print(f"Dataset: {dataset_name}")
        print(f"  Shape: {info[1]}")
        print(f"  Type: {info[3]}")
        print(f"  Dimensions: {info[0]}")

        # Try to get some metadata
        try:
            ds = hdf.select(dataset_name)
            attrs = ds.attributes()
            if attrs:
                print(f"  Attributes:")
                for attr_name in list(attrs.keys())[:3]:  # Show first 3 attributes
                    print(f"    {attr_name}: {attrs[attr_name]}")
        except:
            pass

        print()

    # List global attributes
    print("\nGlobal Attributes:")
    print("-" * 80)
    attrs = hdf.attributes()
    for attr_name in sorted(attrs.keys())[:10]:  # Show first 10 global attributes
        try:
            print(f"{attr_name}: {attrs[attr_name]}")
        except:
            print(f"{attr_name}: <unable to read>")

    hdf.end()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python explore_hdf.py <file.hdf>")
        sys.exit(1)

    explore_hdf4(sys.argv[1])
