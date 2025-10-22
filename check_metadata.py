#!/usr/bin/env python3
"""
Check for metadata and vdata in CALIPSO HDF4 files.
"""

from pyhdf.SD import SD, SDC
from pyhdf.HDF import HDF
from pyhdf.VS import VS
import sys

def check_metadata(filepath):
    """Check for metadata arrays and VData tables."""
    print(f"Checking metadata in: {filepath}")
    print("=" * 80)

    # Open HDF file
    hdf = SD(filepath, SDC.READ)

    # Check for metadata datasets
    print("\nLooking for metadata-related datasets:")
    datasets = hdf.datasets()

    metadata_related = [name for name in datasets.keys() if 'alt' in name.lower() or 'height' in name.lower() or 'metadata' in name.lower()]

    for name in metadata_related:
        ds = hdf.select(name)
        data = ds.get()
        print(f"\n{name}:")
        print(f"  Shape: {data.shape}")
        print(f"  Min: {data.min()}, Max: {data.max()}")
        if len(data.shape) == 1 and len(data) < 600:
            print(f"  First 5 values: {data[:5]}")
            print(f"  Last 5 values: {data[-5:]}")

    hdf.end()

    # Check VData
    print("\n" + "=" * 80)
    print("Checking VData tables:")
    print("=" * 80)

    hdf_file = HDF(filepath)
    vs = hdf_file.vstart()

    vdata_refs = vs.vdatainfo()
    print(f"\nFound {len(vdata_refs)} VData tables:")

    for ref, name, cls in vdata_refs:
        print(f"\nVData: {name} (class: {cls})")
        try:
            vd = vs.attach(ref)
            n_records = vd.inquire()[0]
            field_names = vd.inquire()[3]
            print(f"  Records: {n_records}")
            print(f"  Fields: {field_names}")
            vd.detach()
        except:
            print("  (Unable to read)")

    vs.end()
    hdf_file.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check_metadata.py <file.hdf>")
        sys.exit(1)

    check_metadata(sys.argv[1])
