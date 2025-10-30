# CALIPSO Intensity Scaling Update

## Summary

Updated the entire data pipeline to properly handle CALIPSO 532nm attenuated backscatter intensity values using **physical units** (km⁻¹·sr⁻¹) with a valid range of **0 to 3.5**, instead of raw LAS intensity encoding (0-65535).

## Problem

The viewer was displaying intensity values in raw LAS encoding, which:
- Made it difficult to interpret scientifically (what does intensity "20,000" mean?)
- Used auto-scaling that varied by dataset, preventing comparison across files
- Didn't align with CALIPSO's documented valid range (-0.1 to 3.3 km⁻¹·sr⁻¹)

## Solution

Implemented a two-part fix:

### Part 1: Data Filter (Python - calipso_to_las.py)
**Already completed** - Fixed invalid data filter to reject values outside CALIPSO's valid range

### Part 2: Viewer Scaling (TypeScript - this update)
Convert LAS intensity encoding back to physical units throughout the visualization pipeline

---

## Changes Made

### 1. Core Intensity Color Computation
**File**: `src/utils/copcLoader.ts`

**Function**: `computeIntensityColors()`

**Changes**:
- Added `useCalipsoScaling` parameter (defaults to `true`)
- Converts LAS intensity to physical units: `physical = (intensity / 10000) - 0.1`
- Normalizes using scientific range: 0 to 3.5 km⁻¹·sr⁻¹ (not raw LAS values)
- Maintains backward compatibility with optional standard mode

**Before**:
```typescript
// Used raw LAS values (0-65535)
const normalized = (intensity - minIntensity) / range
```

**After**:
```typescript
// Converts to physical units (km⁻¹·sr⁻¹)
const physical = (lasIntensity / 10000.0) - 0.1
const normalized = (physical - 0.0) / 3.5  // Fixed scientific range
```

---

### 2. Viewer Component Updates
**File**: `src/components/PointCloudViewer.tsx`

#### Change 2a: Intensity Range Computation
**Lines**: 130-138

**Changes**:
- Computes intensity range in **physical units** instead of raw LAS values
- Range passed to UI now shows actual backscatter values (e.g., "0.123 to 2.456")

**Before**:
```typescript
// Stored raw LAS intensity (e.g., 1,230 to 24,560)
minInt = Math.min(minInt, data.intensities[i])
```

**After**:
```typescript
// Convert to physical units before storing range
const lasIntensity = data.intensities[i]
const physical = (lasIntensity / 10000.0) - 0.1
minIntPhysical = Math.min(minIntPhysical, physical)
```

#### Change 2b: Color Mapping Call
**Lines**: 215-226

**Changes**:
- Uses **fixed scientific range** (0 to 3.5) instead of data-derived range
- Enables CALIPSO scaling mode explicitly

**Before**:
```typescript
computeIntensityColors(
  data.intensities,
  colors,
  globalRanges.intensity![0],  // Data-derived min
  globalRanges.intensity![1],  // Data-derived max
  colormap
)
```

**After**:
```typescript
computeIntensityColors(
  data.intensities,
  colors,
  0.0,   // Fixed physical min (km⁻¹·sr⁻¹)
  3.5,   // Fixed physical max (km⁻¹·sr⁻¹)
  colormap,
  true   // Enable CALIPSO scaling
)
```

---

### 3. Control Panel Display
**File**: `src/components/ControlPanel.tsx`

**Lines**: 144-149

**Changes**:
- Updated label to include wavelength and units
- Changed decimal precision from `.toFixed(0)` to `.toFixed(3)` for physical units
- Added unit label (km⁻¹·sr⁻¹)

**Before**:
```typescript
<strong>Intensity:</strong><br />
{dataRange.intensity[0].toFixed(0)} to {dataRange.intensity[1].toFixed(0)}
// Example output: "1230 to 24560"
```

**After**:
```typescript
<strong>Intensity (532nm):</strong><br />
{dataRange.intensity[0].toFixed(3)} to {dataRange.intensity[1].toFixed(3)} km⁻¹·sr⁻¹
// Example output: "0.123 to 2.456 km⁻¹·sr⁻¹"
```

---

### 4. AOI Data Filtering
**File**: `src/utils/aoiSelector.ts`

**Function**: `filterDataByAOI()`

**Lines**: 75-80

**Changes**:
- Converts LAS intensity to physical units when filtering AOI data
- Ensures scatter plot receives physical values

**Before**:
```typescript
// Returned raw LAS intensity
filteredIntensities.push(intensities[i])
```

**After**:
```typescript
// Convert to physical units
const lasIntensity = intensities[i]
const physicalIntensity = (lasIntensity / 10000.0) - 0.1
filteredIntensities.push(physicalIntensity)
```

---

### 5. AOI Scatter Plot
**File**: `src/components/AOIScatterPlot.tsx`

**Changes**:
- Updated X-axis label to include units (km⁻¹·sr⁻¹)
- Set fixed X-axis range (0 to 3.5) for consistent scaling
- Updated tooltip to show 3 decimal places with units

**Before**:
```typescript
// X-axis
title: { text: 'Intensity (Backscatter 532nm)' }
// No min/max set (auto-scaled per dataset)

// Tooltip
const intensity = context.parsed.x.toFixed(0)
return `Alt: ${alt} km, Intensity: ${intensity}`
// Example: "Alt: 5.23 km, Intensity: 15230"
```

**After**:
```typescript
// X-axis
title: { text: 'Intensity (Backscatter 532nm, km⁻¹·sr⁻¹)' }
min: 0,
max: 3.5

// Tooltip
const intensity = context.parsed.x.toFixed(3)
return `Alt: ${alt} km, Intensity: ${intensity} km⁻¹·sr⁻¹`
// Example: "Alt: 5.23 km, Intensity: 1.523 km⁻¹·sr⁻¹"
```

---

## Benefits

### 1. Scientific Accuracy
- Colors now represent actual atmospheric backscatter values
- Values are directly comparable to CALIPSO literature and documentation
- Fixed normalization range (0-3.5) enables consistent interpretation

### 2. Cross-Dataset Comparison
- All datasets use the same intensity scale
- Colors have consistent meaning across different files
- Easier to identify atmospheric features (clouds, aerosols, surface)

### 3. Better User Experience
- Data range display shows physically meaningful values
- Scatter plots show actual backscatter measurements
- Tooltips provide scientifically interpretable information

### 4. Alignment with Data Pipeline
- Viewer now matches the corrected data filter (calipso_to_las.py)
- End-to-end consistency from HDF input to 3D visualization

---

## Example Value Mappings

| Physical Value (km⁻¹·sr⁻¹) | LAS Intensity | Color (Viridis) | Interpretation |
|----------------------------|---------------|-----------------|----------------|
| 0.0 | 1,000 | Dark purple | Clear air |
| 0.5 | 6,000 | Blue | Weak aerosol |
| 1.0 | 11,000 | Cyan/Green | Moderate aerosol/thin cloud |
| 2.0 | 21,000 | Yellow | Dense aerosol/cloud |
| 3.0 | 31,000 | Orange | Thick cloud |
| 3.3 | 34,000 | Red | Max valid (thick cloud/surface) |

---

## Testing Recommendations

1. **Load COPC file** and verify:
   - Data range shows values like "0.123 to 2.456 km⁻¹·sr⁻¹" (not "1230 to 24560")
   - Colors remain consistent when loading different files
   - Maximum intensity is around 3.0-3.5 (not 65,535)

2. **Select AOI and plot**:
   - X-axis range is 0 to 3.5
   - Tooltip shows values like "1.523 km⁻¹·sr⁻¹" (not "15230")
   - Most points cluster in the 0.001 to 0.1 range (typical atmospheric)

3. **Compare with HDF plot**:
   ```bash
   python plot_calipso_hdf.py data.hdf --variable Total_Attenuated_Backscatter_532 --log-scale --output hdf.png
   ```
   - Viewer colors should correspond to HDF plot values
   - High intensity regions (red) should match thick clouds/surface in HDF

---

## Encoding Formula Reference

### LAS Encoding (Python - calipso_to_las.py)
```python
# Convert physical to LAS intensity
las_intensity = (physical + 0.1) * 10000
# Range: physical [-0.1, 3.3] → LAS [0, 34000]
```

### Physical Decoding (TypeScript - viewer)
```typescript
// Convert LAS intensity to physical
physical = (las_intensity / 10000.0) - 0.1
// Range: LAS [0, 34000] → physical [-0.1, 3.3]
```

### Normalization for Colors
```typescript
// Normalize to 0-1 for colormap
normalized = (physical - 0.0) / 3.5
// Range: physical [0, 3.5] → normalized [0, 1]
```

---

## Files Modified

1. `src/utils/copcLoader.ts` - Core intensity color computation
2. `src/components/PointCloudViewer.tsx` - Range computation and color mapping
3. `src/components/ControlPanel.tsx` - UI display formatting
4. `src/utils/aoiSelector.ts` - AOI data filtering
5. `src/components/AOIScatterPlot.tsx` - Scatter plot axes and tooltips

---

## Backward Compatibility

The `computeIntensityColors()` function maintains backward compatibility:
- Set `useCalipsoScaling = false` to use raw LAS intensity values
- Default is `true` for CALIPSO data

For non-CALIPSO LAS files, you can disable this behavior:
```typescript
computeIntensityColors(intensities, colors, undefined, undefined, colormap, false)
```

---

## Related Documentation

- CALIPSO Data Products: https://www-calipso.larc.nasa.gov/products/
- LAS 1.4 Specification: https://www.asprs.org/divisions-committees/lidar-division/laser-las-file-format-exchange-activities
- See also: `CALIPSO_TOOLS_USAGE.md` for complete workflow
