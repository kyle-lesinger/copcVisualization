# CALIPSO Data Conversion Guide

Complete guide for converting CALIPSO satellite LiDAR data from HDF format to web-ready Potree format.

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Conversion Pipeline](#conversion-pipeline)
4. [Usage Examples](#usage-examples)
5. [Technical Details](#technical-details)
6. [Troubleshooting](#troubleshooting)

---

## Overview

This project provides tools to convert CALIPSO (Cloud-Aerosol Lidar and Infrared Pathfinder Satellite Observation) Level 1 HDF4 data into various point cloud formats suitable for analysis and web visualization.

### Supported Conversions

| Script | Input | Output | Purpose |
|--------|-------|--------|---------|
| `calipso_to_las.py` | HDF4 | LAS 1.4 | Basic conversion to point cloud format |
| `convert_tiled.py` | HDF4 | COPC LAZ (tiled) | Spatially-tiled COPC for large datasets |
| `convert_to_potree.py` | HDF4 | Potree | Web-ready octree format for visualization |

### Data Flow

```
CALIPSO HDF4
    ↓
[calipso_to_las.py]
    ↓
LAS 1.4 Point Cloud
    ↓
[PDAL Pipeline]
    ↓
COPC LAZ (Cloud Optimized)
    ↓
[PotreeConverter]
    ↓
Potree Format (Web Visualization)
```

---

## Prerequisites

### Required Software

1. **Python 3.7+** with packages:
   - `pyhdf` - HDF4 file reading
   - `numpy` - Numerical operations
   - `laspy` - LAS file I/O
   - `pyproj` - Coordinate system handling

   Install with:
   ```bash
   pip install pyhdf numpy laspy pyproj
   ```

2. **PDAL (Point Data Abstraction Library)**
   - Required for LAS → COPC conversion
   - Install via conda:
     ```bash
     conda create -n pdal -c conda-forge pdal python-pdal
     conda activate pdal
     ```
   - Or see: https://pdal.io/en/stable/download.html

3. **PotreeConverter** (for Potree format only)
   - Required for `convert_to_potree.py`
   - Installation instructions below

### Installing PotreeConverter

PotreeConverter generates web-optimized octree structures for 3D point cloud visualization.

#### macOS Installation (Tested on Apple Silicon)

Installing PotreeConverter on macOS requires some compatibility fixes. Follow these steps:

**1. Install dependencies:**
```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install CMake
brew install cmake
```

**2. Clone and build PotreeConverter:**
```bash
# Clone the repository
git clone https://github.com/potree/PotreeConverter.git
cd PotreeConverter

# Create build directory
mkdir build && cd build

# Configure with CMake policy flag (required for CMake 4.x)
cmake -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ..

# Build (this may take several minutes)
make
```

**Known Issues & Fixes:**

The upstream PotreeConverter repository has several macOS compatibility issues that may need manual fixes:

1. **Missing macOS fseek definition** - The code doesn't define `fseek_64_all_platforms` for macOS
2. **std::execution::par not supported** - macOS doesn't fully support C++ parallel execution policies
3. **Missing platform-specific functions** - Memory monitoring functions need macOS implementations using Mach APIs

If you encounter build errors, you may need to apply compatibility patches. See the [detailed troubleshooting guide](#potreeconverter-build-errors-macos) below.

**3. Verify installation:**
```bash
./PotreeConverter --help
```

**4. Add to PATH (optional):**
```bash
# Temporary (current session only)
export PATH=$PATH:$(pwd)

# Permanent (add to ~/.zshrc or ~/.bashrc)
echo 'export PATH=$PATH:/path/to/PotreeConverter/build' >> ~/.zshrc

# Or create a symlink
sudo ln -s $(pwd)/PotreeConverter /usr/local/bin/PotreeConverter
```

#### Linux Installation

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install cmake build-essential libtbb-dev

# Clone repository
git clone https://github.com/potree/PotreeConverter.git
cd PotreeConverter

# Build with CMake
mkdir build && cd build
cmake ../
make

# Add to PATH (optional)
export PATH=$PATH:$(pwd)
```

#### Windows Installation

Download pre-built Windows executables from the [PotreeConverter releases page](https://github.com/potree/PotreeConverter/releases).

#### Verify Installation

```bash
PotreeConverter --help
```

Expected output:
```
#threads: 14
PotreeConverter <source> -o <outdir>

  -i [ --source ]         Input file(s)
  -h [ --help ]           Display help information
  -o [ --outdir ]         Output directory
  --encoding              Encoding type "BROTLI", "UNCOMPRESSED" (default)
  ...
```

---

## Conversion Pipeline

### 1. Basic Conversion: HDF → LAS

**Script:** `calipso_to_las.py`

Converts CALIPSO HDF4 files to LAS 1.4 format.

**Features:**
- Extracts latitude, longitude, altitude coordinates
- Stores 532nm backscatter as LAS intensity
- Stores 1064nm backscatter as extra dimension
- Applies validity filters to remove noisy data
- Supports spatial filtering by lat/lon bounds

**Usage:**
```bash
python calipso_to_las.py <input.hdf> [output.las]
```

**Example:**
```bash
python calipso_to_las.py CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf
```

### 2. Tiled Conversion: HDF → COPC (Tiled)

**Script:** `convert_tiled.py`

Converts HDF to spatially-tiled COPC files to avoid processing issues with very large point clouds.

**Features:**
- Splits data into 4 latitude-based tiles:
  - South: -90° to -30°
  - South Mid: -30° to 0°
  - North Mid: 0° to 30°
  - North: 30° to 90°
- Generates compressed COPC LAZ files
- Maintains proper coordinate reference system (EPSG:4326)

**Usage:**
```bash
python convert_tiled.py <input.hdf> [output_dir]
```

**Example:**
```bash
python convert_tiled.py CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf output_tiles
```

**Output Structure:**
```
output_tiles/
├── filename_tile_south.las
├── filename_tile_south.copc.laz
├── filename_tile_south_mid.las
├── filename_tile_south_mid.copc.laz
├── filename_tile_north_mid.las
├── filename_tile_north_mid.copc.laz
├── filename_tile_north.las
└── filename_tile_north.copc.laz
```

### 3. Web-Ready Conversion: HDF → Potree

**Script:** `convert_to_potree.py`

Complete pipeline from HDF to web-ready Potree format.

**Features:**
- Fully automated pipeline (HDF → LAS → COPC → Potree)
- Checks for PotreeConverter installation
- Optional cleanup of intermediate files
- Generates octree structure for efficient web rendering

**Usage:**
```bash
python convert_to_potree.py <input.hdf> [options]
```

**Options:**
- `-o, --output-dir DIR` - Output directory (default: `potree_data`)
- `--potree-path PATH` - Path to PotreeConverter executable
- `--pdal-path PATH` - Path to PDAL executable
- `--keep-intermediate` - Keep LAS and COPC files

**Examples:**

Basic conversion:
```bash
python convert_to_potree.py CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf
```

Specify output directory:
```bash
python convert_to_potree.py input.hdf -o my_potree_data
```

Keep intermediate files for inspection:
```bash
python convert_to_potree.py input.hdf --keep-intermediate
```

Specify PotreeConverter location:
```bash
python convert_to_potree.py input.hdf --potree-path /home/user/PotreeConverter/build/PotreeConverter
```

**Output Structure:**
```
potree_data/
└── filename/
    ├── metadata.json
    ├── hierarchy.bin
    └── octree.bin
```

---

## Usage Examples

### Example 1: Quick Potree Conversion

Convert a single HDF file to Potree format with default settings:

```bash
python convert_to_potree.py CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf
```

Expected output:
```
✓ Found PotreeConverter: /usr/local/bin/PotreeConverter

================================================================================
Converting CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf to Potree format
================================================================================
Pipeline: HDF → LAS → COPC → Potree
Output directory: potree_data

Step 1/3: Converting HDF to LAS...
Reading CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.hdf...
Profiles: 4224
Altitude bins: 583
Creating point cloud with 2,462,592 points...
Valid points after filtering: 823,530 (33.4%)
✓ Created LAS file: potree_data/CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.las

Step 2/3: Converting LAS to COPC...
✓ Created COPC file: potree_data/CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN.copc.laz
  File size: 12.3 MB

Step 3/3: Converting COPC to Potree...
✓ Created Potree format files in: potree_data/CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN

================================================================================
✓ Conversion complete!
Potree output: potree_data/CAL_LID_L1-Standard-V4-20.2019-01-01T00-00-00ZN
================================================================================
```

### Example 2: Batch Processing Multiple Files

Convert multiple HDF files in a directory:

```bash
#!/bin/bash
for hdf_file in data/*.hdf; do
    echo "Processing: $hdf_file"
    python convert_to_potree.py "$hdf_file" -o potree_data
done
```

### Example 3: Create Tiled COPC for Large Dataset

For very large datasets, use tiled conversion:

```bash
python convert_tiled.py large_dataset.hdf output_tiles
```

This creates 4 separate COPC files that can be loaded independently or merged later.

---

## Technical Details

### CALIPSO Data Structure

CALIPSO Level 1 HDF4 files contain:
- **Latitude/Longitude:** Profile-level geographic coordinates
- **Altitude:** 583 bins from -2.0 to 40.0 km
- **Backscatter Data:** 2D arrays [profiles × altitudes]
  - Total Attenuated Backscatter at 532nm
  - Attenuated Backscatter at 1064nm
- **Profile Time:** TAI seconds since 1993-01-01 00:00:00 UTC

### Point Cloud Transformation

The conversion process transforms 2D satellite swath data into 3D point clouds:

```
2D Structure:                    3D Point Cloud:
[profiles × altitudes]     →     [points]

Each profile:                    Each point:
- lat, lon                       - X (longitude)
- time                           - Y (latitude)
- backscatter[583]               - Z (altitude)
                                 - Intensity (532nm)
                                 - Extra: backscatter_1064
                                 - GPS time
```

### Data Filtering

**Validity Filters Applied:**
- 532nm backscatter: -0.2 to 3.5 (1/(km·sr))
- 1064nm backscatter: -0.1 to 2.6 (1/(km·sr))
- Removes non-finite values
- Typically retains 30-40% of raw points

### Coordinate Reference System

- **CRS:** EPSG:4326 (WGS84)
- **Units:** Decimal degrees (X, Y), kilometers (Z)
- **Precision:**
  - XY scale: 0.0001° (~11m at equator)
  - Z scale: 0.001 km (1m vertical resolution)

### File Formats

#### LAS 1.4
- Point Format: 6 (no RGB, supports extra bytes)
- Intensity: Scaled 532nm backscatter (0-65535)
- Extra Dimension: `backscatter_1064` (float64)
- GPS Time: TAI seconds

#### COPC (Cloud Optimized Point Cloud)
- Based on LAZ (compressed LAS)
- Spatially-indexed octree structure
- Supports streaming and partial reads
- Optimized for web delivery

#### Potree
- Multi-resolution octree structure
- 3 output files (metadata, hierarchy, octree)
- 10-50x faster than Potree v1.7
- Supports web-based 3D visualization

---

## Troubleshooting

### PotreeConverter Not Found

**Error:**
```
✗ PotreeConverter not found. Please install and try again.
```

**Solutions:**
1. Install PotreeConverter (see [Prerequisites](#prerequisites))
2. Add PotreeConverter to your PATH:
   ```bash
   export PATH=$PATH:/path/to/PotreeConverter/build
   ```
3. Specify explicit path:
   ```bash
   python convert_to_potree.py input.hdf --potree-path /path/to/PotreeConverter
   ```

### PDAL Not Found

**Error:**
```
FileNotFoundError: [Errno 2] No such file or directory: '/opt/anaconda3/envs/pdal/bin/pdal'
```

**Solutions:**
1. Install PDAL in conda environment:
   ```bash
   conda create -n pdal -c conda-forge pdal
   ```
2. Activate the environment:
   ```bash
   conda activate pdal
   ```
3. Specify custom PDAL path:
   ```bash
   python convert_to_potree.py input.hdf --pdal-path /path/to/pdal
   ```

### No Points After Filtering

**Error:**
```
ValueError: No points remain after filtering. Check filter bounds.
```

**Cause:** Spatial filter bounds don't intersect with the data.

**Solution:** Check the HDF file's geographic extent:
```python
from pyhdf.SD import SD, SDC

hdf = SD('input.hdf', SDC.READ)
lat = hdf.select('Latitude').get()
lon = hdf.select('Longitude').get()

print(f"Latitude range: {lat.min():.2f} to {lat.max():.2f}")
print(f"Longitude range: {lon.min():.2f} to {lon.max():.2f}")
```

### Memory Issues with Large Files

**Symptom:** Script crashes or system runs out of memory.

**Solutions:**
1. Use tiled conversion instead:
   ```bash
   python convert_tiled.py large_file.hdf output_tiles
   ```
2. Process tiles individually:
   ```bash
   python convert_to_potree.py output_tiles/filename_tile_north.copc.laz
   ```

### HDF4 Read Errors

**Error:**
```
pyhdf.error.HDF4Error: Dataset 'XXX' not found
```

**Cause:** Not a CALIPSO Level 1 file or file is corrupted.

**Solution:** Verify file contents:
```bash
# List datasets in HDF file
python explore_hdf.py input.hdf
```

### COPC Cube Calculation Issues

**Symptom:** PDAL hangs or produces very large files.

**Cause:** Global CALIPSO data creates numerical precision issues in octree calculation.

**Solution:** Use spatially-tiled conversion:
```bash
python convert_tiled.py input.hdf output_tiles
```

### PotreeConverter Build Errors (macOS)

If you encounter compilation errors when building PotreeConverter on macOS, here are the specific fixes needed:

#### Error 1: "use of undeclared identifier 'fseek_64_all_platforms'"

**Error message:**
```
./Converter/modules/unsuck/unsuck.hpp:435:3: error: use of undeclared identifier 'fseek_64_all_platforms'
```

**Cause:** The code doesn't define the fseek function for macOS.

**Fix:** Edit `Converter/modules/unsuck/unsuck.hpp` around line 42-48:

```cpp
#if defined(__linux__)
constexpr auto fseek_64_all_platforms = fseeko64;
#elif defined(WIN32)
constexpr auto fseek_64_all_platforms = _fseeki64;
#elif defined(__APPLE__) || defined(__MACH__)
constexpr auto fseek_64_all_platforms = fseeko;  // Add this line
#endif
```

#### Error 2: "no member named 'par' in namespace 'std::execution'"

**Error message:**
```
./Converter/include/PotreeConverter.h:210:35: error: no member named 'par' in namespace 'std::execution'
```

**Cause:** macOS doesn't fully support C++ parallel execution policies.

**Fix 1:** Add conditional compilation to header files. In `Converter/include/PotreeConverter.h`:

```cpp
#pragma once

// macOS doesn't fully support std::execution parallel policies
#if !defined(__APPLE__) && !defined(__MACH__)
#include <execution>
#endif

#include "Vector3.h"
#include "LasLoader/LasLoader.h"
```

**Fix 2:** Modify parallel execution calls to use sequential on macOS. In `Converter/include/PotreeConverter.h` around line 210:

```cpp
// compute scale and offset from all sources
{
    mutex mtx;
#if defined(__APPLE__) || defined(__MACH__)
    // macOS: use sequential execution
    for_each(sources.begin(), sources.end(), [&mtx, &sources, &scaleMin, &min, &max, requestedAttributes, &fullAttributeList, &acceptedAttributeNames](Source source) {
#else
    auto parallel = std::execution::par;
    for_each(parallel, sources.begin(), sources.end(), [&mtx, &sources, &scaleMin, &min, &max, requestedAttributes, &fullAttributeList, &acceptedAttributeNames](Source source) {
#endif
```

**Fix 3:** Apply the same pattern to other files:
- `Converter/src/main.cpp` (line 4 and line 186)
- `Converter/include/sampler_poisson.h` (line 4 and line 185)
- `Converter/include/sampler_poisson_average.h` (line 4 and line 286)

#### Error 3: Undefined symbols for getMemoryData(), launchMemoryChecker()

**Error message:**
```
ld: symbol(s) not found for architecture arm64
  "getMemoryData()", referenced from:
  "launchMemoryChecker(long long, double)", referenced from:
```

**Cause:** The file `Converter/modules/unsuck/unsuck_platform_specific.cpp` only has implementations for Windows and Linux, not macOS.

**Fix:** Add macOS implementations at the end of `unsuck_platform_specific.cpp` before the final `#endif`:

```cpp
#elif defined(__APPLE__) || defined(__MACH__)

// macOS implementation
#include <mach/mach.h>
#include <sys/sysctl.h>
#include <sys/types.h>

MemoryData getMemoryData() {
    MemoryData data;

    // Get system memory info
    int64_t physical_memory;
    size_t len = sizeof(physical_memory);
    sysctlbyname("hw.memsize", &physical_memory, &len, NULL, 0);

    // Get process memory info
    struct mach_task_basic_info info;
    mach_msg_type_number_t size = MACH_TASK_BASIC_INFO_COUNT;
    kern_return_t kerr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &size);

    int64_t physMemUsedByMe = 0;
    int64_t virtualMemUsedByMe = 0;

    if (kerr == KERN_SUCCESS) {
        physMemUsedByMe = info.resident_size;
        virtualMemUsedByMe = info.virtual_size;
    }

    static int64_t virtualUsedMax = 0;
    static int64_t physicalUsedMax = 0;

    virtualUsedMax = std::max(virtualMemUsedByMe, virtualUsedMax);
    physicalUsedMax = std::max(physMemUsedByMe, physicalUsedMax);

    data.physical_total = physical_memory;
    data.physical_used = 0;
    data.physical_usedByProcess = physMemUsedByMe;
    data.physical_usedByProcess_max = physicalUsedMax;

    data.virtual_total = 0;
    data.virtual_used = 0;
    data.virtual_usedByProcess = virtualMemUsedByMe;
    data.virtual_usedByProcess_max = virtualUsedMax;

    return data;
}

void printMemoryReport() {
    auto memoryData = getMemoryData();
    double vm = double(memoryData.virtual_usedByProcess) / (1024.0 * 1024.0 * 1024.0);
    double pm = double(memoryData.physical_usedByProcess) / (1024.0 * 1024.0 * 1024.0);

    stringstream ss;
    ss << "memory usage: "
        << "virtual: " << formatNumber(vm, 1) << " GB, "
        << "physical: " << formatNumber(pm, 1) << " GB"
        << endl;

    cout << ss.str();
}

void launchMemoryChecker(int64_t maxMB, double checkInterval) {
    auto interval = std::chrono::milliseconds(int64_t(checkInterval * 1000));

    thread t([maxMB, interval]() {
        while (true) {
            auto memdata = getMemoryData();
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(interval);
        }
    });
    t.detach();
}

static int numProcessors;
static bool initialized = false;

void init() {
    numProcessors = std::thread::hardware_concurrency();
    initialized = true;
}

CpuData getCpuData() {
    if (!initialized) {
        init();
    }

    CpuData data;
    data.numProcessors = numProcessors;
    data.usage = 0.0; // Simplified for macOS

    return data;
}

#endif
```

#### Error 4: Narrowing conversion in sampler_poisson.h

**Error message:**
```
error: non-constant-expression cannot be narrowed from type 'int64_t' to 'int32_t'
```

**Fix:** In `Converter/include/sampler_poisson.h` around line 106:

```cpp
Point point = { x, y, z, static_cast<int32_t>(i), static_cast<int32_t>(childIndex) };
```

#### Error 5: TBB library not found (macOS)

**Error message:**
```
ld: library 'tbb' not found
```

**Cause:** TBB isn't needed on macOS since we're using sequential execution.

**Fix:** Modify `CMakeLists.txt` around line 56-66:

```cmake
if (UNIX)
    find_package(Threads REQUIRED)
    target_link_libraries(${PROJECT_NAME} Threads::Threads)

    if (NOT APPLE)
        find_package(TBB REQUIRED)
        target_link_libraries(${PROJECT_NAME} tbb)
    endif()

    #SET(CMAKE_CXX_FLAGS "-pthread -ltbb")
endif (UNIX)
```

#### Complete Rebuild After Fixes

After applying the fixes, rebuild from scratch:

```bash
cd PotreeConverter/build
rm -rf *
cmake -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ..
make
```

If successful, you should see:
```
[100%] Built target brotli
```

And the executable will be at:
```
PotreeConverter/build/PotreeConverter
```

---

## Performance Considerations

### File Sizes

Typical file sizes for one CALIPSO orbit (~4,000 profiles):

| Format | Size | Compression |
|--------|------|-------------|
| HDF4 (input) | ~50 MB | Custom |
| LAS 1.4 | ~25 MB | None |
| COPC LAZ | ~12 MB | LAZ compressed |
| Potree | ~10 MB | Binary octree |

### Processing Time

Approximate processing times on modern hardware:

| Stage | Time | Notes |
|-------|------|-------|
| HDF → LAS | 5-10s | CPU-bound |
| LAS → COPC | 10-20s | I/O-bound |
| COPC → Potree | 15-30s | CPU-bound |
| **Total** | **30-60s** | Per file |

### Optimization Tips

1. **Use SSDs:** COPC and Potree conversions are I/O intensive
2. **Batch process:** Convert multiple files in parallel
3. **Keep intermediate files:** If converting to multiple formats, use `--keep-intermediate`
4. **Tile large datasets:** Use `convert_tiled.py` for files with >5M points

---

## Additional Resources

### CALIPSO Data

- [CALIPSO Data Products Catalog](https://www-calipso.larc.nasa.gov/products/)
- [CALIPSO User's Guide](https://www-calipso.larc.nasa.gov/resources/calipso_users_guide/)
- [NASA ASDC Data Download](https://asdc.larc.nasa.gov/project/CALIPSO)

### Point Cloud Formats

- [PDAL Documentation](https://pdal.io/)
- [LAS Specification](https://www.asprs.org/divisions-committees/lidar-division/laser-las-file-format-exchange-activities)
- [COPC Specification](https://copc.io/)
- [Potree Viewer](http://potree.org/)

### Visualization Tools

- [deck.gl](https://deck.gl/) - WebGL visualization framework
- [Cesium](https://cesium.com/) - 3D geospatial platform
- [Potree Viewer](https://github.com/potree/potree) - Web-based point cloud viewer

---

## License

This software is provided as-is for scientific and educational use. Please cite CALIPSO data appropriately when publishing results.

## Contact

For issues or questions, please check the project repository or contact the development team.
