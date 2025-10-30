# CALIPSO Data Processing Tools - Usage Guide

## Overview

This project includes two main Python scripts for working with CALIPSO HDF4 files:

1. **`calipso_to_las.py`** - Convert HDF to LAS/COPC format for 3D visualization
2. **`plot_calipso_hdf.py`** - Visualize HDF data as 2D curtain plots (NEW)

---

## Recent Changes

### Fixed Data Filter Issue (calipso_to_las.py)

**Problem**: The data filter was too permissive, allowing 532nm attenuated backscatter values up to 10.0 when the valid CALIPSO range is -0.1 to 3.3. This caused extremely high intensity values to appear in the output.

**Solution**: Updated filter thresholds to match CALIPSO documentation:
- **532nm**: Changed from `(-1.0, 10.0)` to `(-0.2, 3.5)`
- **1064nm**: Changed from `(-1.0, 10.0)` to `(-0.1, 2.6)`

**Impact**: Output COPC files will now only contain valid backscatter measurements, resulting in more scientifically accurate intensity values (< 5 as expected).

---

## Tool 1: Convert HDF to LAS/COPC

### Basic Usage
```bash
python calipso_to_las.py input.hdf [output.las]
```

### Example
```bash
# Convert to LAS
python calipso_to_las.py CAL_LID_L1-Standard-V4-10.2010-01-01T00-00-00ZN.hdf

# Convert to COPC (requires PDAL)
python calipso_to_las.py data.hdf data.las
pdal translate data.las data.copc.laz --writer copc
```

### Output
- Creates a LAS 1.4 file with:
  - **XYZ**: Longitude, Latitude, Altitude (WGS84)
  - **Intensity**: Scaled 532nm attenuated backscatter (0-65535)
  - **Extra Dimension**: Original 1064nm backscatter values
  - **GPS Time**: TAI seconds since 1993-01-01

---

## Tool 2: Visualize HDF Data (NEW)

### List Available Variables
```bash
python plot_calipso_hdf.py data.hdf --list
```

This shows all variables in the file with their shapes and data types.

### Plot a Variable
```bash
# Basic plot (displays on screen)
python plot_calipso_hdf.py data.hdf --variable Total_Attenuated_Backscatter_532

# Save to file
python plot_calipso_hdf.py data.hdf --variable Total_Attenuated_Backscatter_532 --output backscatter_532.png
```

### Advanced Options

#### Custom Color Range
```bash
python plot_calipso_hdf.py data.hdf \
  --variable Total_Attenuated_Backscatter_532 \
  --vmin -0.001 \
  --vmax 0.01 \
  --output plot.png
```

#### Logarithmic Scale (Recommended for Backscatter)
```bash
python plot_calipso_hdf.py data.hdf \
  --variable Total_Attenuated_Backscatter_532 \
  --log-scale \
  --vmin 0.0001 \
  --vmax 0.1 \
  --output plot_log.png
```

#### Different Colormap
```bash
python plot_calipso_hdf.py data.hdf \
  --variable Attenuated_Backscatter_1064 \
  --cmap jet \
  --output 1064nm_jet.png
```

#### High-Resolution Output
```bash
python plot_calipso_hdf.py data.hdf \
  --variable Total_Attenuated_Backscatter_532 \
  --dpi 300 \
  --output high_res.png
```

### Common Variables to Plot
- `Total_Attenuated_Backscatter_532` - 532nm backscatter (main)
- `Attenuated_Backscatter_1064` - 1064nm backscatter
- `Perpendicular_Attenuated_Backscatter_532` - Perpendicular polarization at 532nm
- `Latitude` - Latitude profile (1D)
- `Longitude` - Longitude profile (1D)

---

## Workflow Recommendations

### 1. Quality Check Before Processing
Before converting to COPC, visualize the data to check quality:

```bash
# List variables
python plot_calipso_hdf.py data.hdf --list

# Plot 532nm backscatter with log scale
python plot_calipso_hdf.py data.hdf \
  --variable Total_Attenuated_Backscatter_532 \
  --log-scale \
  --output qa_532nm.png

# Plot 1064nm backscatter
python plot_calipso_hdf.py data.hdf \
  --variable Attenuated_Backscatter_1064 \
  --log-scale \
  --output qa_1064nm.png
```

### 2. Convert to COPC for 3D Visualization
```bash
# Convert to LAS with corrected filters
python calipso_to_las.py data.hdf data.las

# Convert to COPC (requires PDAL)
pdal translate data.las data.copc.laz --writer copc
```

### 3. Verify Output
After conversion, you should now see:
- 532nm intensity values in a reasonable range (scaled from -0.2 to 3.5)
- No extreme outliers > 35,000 in the intensity field
- Cleaner, more interpretable visualizations

---

## Expected Value Ranges

After the filter fix, you should see:

| Parameter | Physical Units | Scaled LAS Intensity |
|-----------|---------------|---------------------|
| 532nm backscatter | -0.2 to 3.5 km⁻¹·sr⁻¹ | 0 to ~35,000 |
| 1064nm backscatter | -0.1 to 2.6 km⁻¹·sr⁻¹ | (stored unscaled in extra dimension) |

Most atmospheric features show backscatter values between 0.001 and 0.1 km⁻¹·sr⁻¹ at 532nm.

---

## Troubleshooting

### Issue: "No valid points after filtering"
- Your HDF file may be corrupted or outside the region of interest
- Check the raw data with `plot_calipso_hdf.py` first

### Issue: Plot shows all white/single color
- Try using `--log-scale` for backscatter data
- Adjust `--vmin` and `--vmax` based on your data range
- Check for fill values (-9999) in the data

### Issue: matplotlib not found
```bash
pip install matplotlib
```

### Issue: pyhdf not found
```bash
# macOS
brew install hdf4
pip install pyhdf

# Linux (Ubuntu/Debian)
sudo apt-get install libhdf4-dev
pip install pyhdf
```

---

## Dependencies

Both scripts require:
- Python 3.7+
- `numpy`
- `pyhdf` (for HDF4 file reading)
- `laspy` (for calipso_to_las.py only)
- `matplotlib` (for plot_calipso_hdf.py only)

Install all:
```bash
pip install numpy pyhdf laspy matplotlib
```

---

## Questions?

For more information about CALIPSO data products, see:
https://www-calipso.larc.nasa.gov/products/
