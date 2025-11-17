# Converting COPC to Potree with Correct Projection

## The Problem

Your COPC files are in **EPSG:3857 (Web Mercator)** with coordinates in meters, but PotreeConverter was interpreting them as **EPSG:4326 (WGS84)** with coordinates in degrees. This caused:

- Latitudes showing as 304° (impossible - max is 90°)
- Altitudes of -1,237 km or 360 km (wrong for CALIPSO: 0-40 km)
- Points scattered randomly or "above the satellite"

## The Solution

**Reproject COPC from EPSG:3857 → EPSG:4326 using PDAL, then convert to Potree**

This preserves the correct coordinate system and scale/offset values.

---

## Prerequisites

1. **PDAL** - Install via conda:
   ```bash
   conda install -c conda-forge pdal python-pdal
   ```

2. **PotreeConverter** - Download from:
   - https://github.com/potree/PotreeConverter/releases
   - Or compile from source: https://github.com/potree/PotreeConverter

3. **Verify installations:**
   ```bash
   pdal --version  # Should show PDAL version
   PotreeConverter --help  # Should show usage
   ```

---

## Quick Start

### Convert a single file:

```bash
python3 convert_copc_to_potree.py \
  output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz \
  public/potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD
```

### Convert all files in a directory:

```bash
python3 convert_all_copc_to_potree.py \
  output/ \
  public/potree_data/
```

---

## What the Scripts Do

### Step 1: Reprojection (PDAL)

```
COPC (EPSG:3857)  →  LAS (EPSG:4326)
Web Mercator         WGS84
Meters               Degrees
```

**PDAL Pipeline:**
```json
{
  "pipeline": [
    {
      "type": "readers.copc",
      "filename": "input.copc.laz"
    },
    {
      "type": "filters.reprojection",
      "in_srs": "EPSG:3857",
      "out_srs": "EPSG:4326"
    },
    {
      "type": "writers.las",
      "filename": "output.las",
      "scale_x": "0.0000001",  // ~1cm precision
      "scale_y": "0.0000001",  // ~1cm precision
      "scale_z": "0.001",      // 1mm precision
      "a_srs": "EPSG:4326"
    }
  ]
}
```

### Step 2: Potree Conversion

```
LAS (EPSG:4326)  →  Potree 2.0 Format
WGS84               Octree hierarchy
```

**PotreeConverter Command:**
```bash
PotreeConverter input.las \
  -o output_dir/ \
  --overwrite \
  --generate-page index \
  --projection "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
```

### Step 3: Validation

The script automatically verifies:
- ✅ Longitude: -180° to 180°
- ✅ Latitude: -90° to 90°
- ✅ Altitude: 0 to ~100 km

---

## Expected Output

After conversion, `metadata.json` should show:

```json
{
  "version": "2.0",
  "boundingBox": {
    "min": [-179.996, -55.045, 0.381],
    "max": [179.999, 81.670, 40.000]
  },
  "scale": [0.0000001, 0.0000001, 0.001],
  "offset": [-179.996, -55.045, 0.381]
}
```

**Key checks:**
- ✅ Latitude ≤ 90° (was showing 304°)
- ✅ Altitude ≤ 100 km (was showing 360 km or -1,237 km)
- ✅ Scale matches precision: `[1e-7, 1e-7, 0.001]`

---

## Troubleshooting

### 1. `PotreeConverter: command not found`

**Solution:** Add PotreeConverter to your PATH or specify full path in script:

```python
cmd = [
    '/path/to/PotreeConverter',  # Full path
    input_las,
    ...
]
```

### 2. `pdal: command not found`

**Solution:** Activate conda environment with PDAL:
```bash
conda activate pdal  # Or your environment name
```

### 3. Conversion is slow

**Solution:** Convert files in parallel:

In `convert_all_copc_to_potree.py`, change:
```python
max_workers = 4  # Use 4 parallel processes
```

### 4. "Points still look wrong"

**Check your input COPC:**
```bash
pdal info input.copc.laz | grep srs
```

Should show: `"srs": "EPSG:3857"`

If it shows EPSG:4326, the COPC is already in WGS84 - skip reprojection:
```python
# Modify pipeline to remove reprojection filter
```

### 5. Out of memory

**Solution:** Process fewer points or increase point budget:

```bash
PotreeConverter input.las \
  -o output/ \
  --spacing 2.0  # Increase spacing to reduce points
```

---

## Alternative: Use Entwine (EPT Format)

If Potree continues to have issues, consider **Entwine** which creates **EPT format** (also works with deck.gl):

```bash
conda install -c conda-forge entwine

entwine build \
  -i input.copc.laz \
  -o output_ept/ \
  --srs EPSG:4326
```

EPT advantages:
- ✅ Better coordinate system handling
- ✅ Cloud-optimized (like COPC)
- ✅ Works with deck.gl/Potree
- ✅ No Web Mercator issues

---

## Reference

- **Your working COPC code:** https://github.com/paridhi-parajuli/calipso_point_cloud/blob/main/make_copc.ipynb
- **PDAL Reprojection:** https://pdal.io/stages/filters.reprojection.html
- **PotreeConverter:** https://github.com/potree/PotreeConverter
- **Entwine:** https://entwine.io/

---

## Known Issues with PotreeConverter + EPSG:3857

⚠️ **Distance Doubling Bug:** Converting directly from EPSG:4326 → EPSG:3857 in Potree causes a 2x distance increase and flattened appearance (GitHub Issue #339).

**This is why we reproject FIRST with PDAL** (which handles projections correctly), then convert to Potree in WGS84.
