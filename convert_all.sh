#!/bin/bash
#
# Batch convert all CALIPSO HDF files to COPC format
#
# Usage: ./convert_all.sh
#

set -e  # Exit on error

# Activate conda environment
source /opt/anaconda3/etc/profile.d/conda.sh
conda activate pdal

# Create output directory
mkdir -p output

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DATA_DIR="$SCRIPT_DIR/data"
OUTPUT_DIR="$SCRIPT_DIR/output"

echo "========================================="
echo "CALIPSO to COPC Conversion Pipeline"
echo "========================================="
echo ""

# Count HDF files
HDF_COUNT=$(ls "$DATA_DIR"/*.hdf 2>/dev/null | wc -l | tr -d ' ')
echo "Found $HDF_COUNT HDF files to process"
echo ""

# Process each HDF file
for hdf_file in "$DATA_DIR"/*.hdf; do
    if [ ! -f "$hdf_file" ]; then
        echo "No HDF files found in $DATA_DIR"
        exit 1
    fi

    # Get base filename without extension
    base_name=$(basename "$hdf_file" .hdf)

    echo "----------------------------------------"
    echo "Processing: $base_name"
    echo "----------------------------------------"

    # Step 1: Convert HDF to LAS
    las_file="$OUTPUT_DIR/${base_name}.las"
    echo "Step 1/2: Converting HDF to LAS..."
    python3 "$SCRIPT_DIR/calipso_to_las.py" "$hdf_file" "$las_file"

    # Check if LAS was created successfully
    if [ ! -f "$las_file" ]; then
        echo "ERROR: Failed to create LAS file for $base_name"
        continue
    fi

    # Step 2: Convert LAS to COPC using PDAL
    copc_file="$OUTPUT_DIR/${base_name}.copc.laz"
    echo "Step 2/2: Converting LAS to COPC..."
    pdal pipeline "$SCRIPT_DIR/las_to_copc.json" \
        --readers.las.filename="$las_file" \
        --writers.copc.filename="$copc_file"

    # Check if COPC was created successfully
    if [ -f "$copc_file" ]; then
        echo "SUCCESS: Created $copc_file"

        # Optionally remove intermediate LAS file to save space
        # Uncomment the following line to delete LAS files after COPC conversion
        # rm "$las_file"
        # echo "Removed intermediate LAS file"
    else
        echo "ERROR: Failed to create COPC file for $base_name"
    fi

    echo ""
done

echo "========================================="
echo "Conversion Complete!"
echo "========================================="
echo ""
echo "Output files location: $OUTPUT_DIR"
echo ""

# List output files with sizes
echo "Generated COPC files:"
ls -lh "$OUTPUT_DIR"/*.copc.laz 2>/dev/null || echo "No COPC files generated"
echo ""

# Optional: Display file info using PDAL
echo "File information (first COPC file):"
FIRST_COPC=$(ls "$OUTPUT_DIR"/*.copc.laz 2>/dev/null | head -1)
if [ -f "$FIRST_COPC" ]; then
    pdal info "$FIRST_COPC" --summary
fi
