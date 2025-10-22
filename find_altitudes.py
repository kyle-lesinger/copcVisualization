#!/usr/bin/env python3
"""
Find altitude information in CALIPSO HDF4 files.
"""

from pyhdf.SD import SD, SDC
from pyhdf.HDF import HDF
from pyhdf.V import V
import sys
import numpy as np

def find_altitudes(filepath):
    """Find altitude information in HDF4 file."""
    print(f"Searching for altitude data in: {filepath}")
    print("=" * 80)

    # Open HDF file
    hdf_file = HDF(filepath)

    # Try Vgroup approach (metadata)
    v = hdf_file.vgstart()

    # Get reference to root vgroup
    print("\nVgroups in file:")
    ref = -1
    while True:
        try:
            ref = v.getid(ref)
            vg = v.attach(ref)
            print(f"  {vg._name} (class: {vg._class})")

            # Check if this is metadata group
            if 'metadata' in vg._name.lower():
                print(f"\n  Found metadata group: {vg._name}")
                print(f"  Number of members: {vg._nmembers}")

                # Try to get members
                members = vg.tagrefs()
                print(f"  Members: {len(members)}")

                for tag, ref_member in members[:10]:  # Show first 10
                    try:
                        if tag == 1962:  # HDF VDATA tag
                            print(f"    VData ref: {ref_member}")
                        elif tag == 1965:  # HDF VGROUP tag
                            sub_vg = v.attach(ref_member)
                            print(f"    Subgroup: {sub_vg._name}")
                            sub_vg.detach()
                    except:
                        pass

            vg.detach()
        except:
            break

    v.end()

    # Check for Lidar_Data_Altitudes specifically
    print("\n" + "=" * 80)
    print("Looking for Lidar_Data_Altitudes:")

    # Try to access as VData
    from pyhdf.VS import VS
    vs = hdf_file.vstart()

    # Look for altitude vdata by name
    try:
        vd_ref = vs.find('Lidar_Data_Altitudes')
        if vd_ref:
            vd = vs.attach(vd_ref)
            n_records, interlace, fields, size, name = vd.inquire()
            print(f"\nFound VData: {name}")
            print(f"  Records: {n_records}")
            print(f"  Fields: {fields}")

            # Read data
            data = vd.read(nRec=n_records)
            altitudes = np.array(data[0])  # First field
            print(f"  Altitude shape: {altitudes.shape}")
            print(f"  Altitude range: {altitudes.min():.3f} to {altitudes.max():.3f} km")
            print(f"  First 5 altitudes: {altitudes[:5]}")
            print(f"  Last 5 altitudes: {altitudes[-5:]}")

            vd.detach()
        else:
            print("  Lidar_Data_Altitudes not found as VData")
    except Exception as e:
        print(f"  Error reading VData: {e}")

    vs.end()
    hdf_file.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python find_altitudes.py <file.hdf>")
        sys.exit(1)

    find_altitudes(sys.argv[1])
