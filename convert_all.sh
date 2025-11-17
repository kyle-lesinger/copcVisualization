#!/bin/bash
#
# Batch convert all CALIPSO HDF files to COPC and Potree formats
#
# Usage: ./convert_all.sh
#

set -e  # Exit on error

# Activate conda environment
source /opt/anaconda3/etc/profile.d/conda.sh
conda activate pdal

# Create output directories
mkdir -p output
mkdir -p potree_data

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DATA_DIR="$SCRIPT_DIR/data"
OUTPUT_DIR="$SCRIPT_DIR/output"
POTREE_DIR="$SCRIPT_DIR/potree_data"
POTREE_CONVERTER="$SCRIPT_DIR/PotreeConverter/build/PotreeConverter"

echo "========================================="
echo "CALIPSO to COPC and Potree Pipeline"
echo "========================================="
echo ""

# Check if PotreeConverter exists
if [ -f "$POTREE_CONVERTER" ]; then
    echo "✓ PotreeConverter found at: $POTREE_CONVERTER"
else
    echo "⚠ PotreeConverter not found at: $POTREE_CONVERTER"
    echo "  Potree conversion will be skipped (COPC files will still be created)"
fi
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
    echo "Step 1/3: Converting HDF to LAS..."
    python3 "$SCRIPT_DIR/calipso_to_las.py" "$hdf_file" "$las_file"

    # Check if LAS was created successfully
    if [ ! -f "$las_file" ]; then
        echo "ERROR: Failed to create LAS file for $base_name"
        continue
    fi

    # Step 2: Convert LAS to COPC using PDAL
    copc_file="$OUTPUT_DIR/${base_name}.copc.laz"
    echo "Step 2/3: Converting LAS to COPC..."
    pdal pipeline "$SCRIPT_DIR/las_to_copc.json" \
        --readers.las.filename="$las_file" \
        --writers.copc.filename="$copc_file"

    # Check if COPC was created successfully
    if [ -f "$copc_file" ]; then
        echo "SUCCESS: Created $copc_file"

        # Step 3: Convert COPC to Potree format (optional - will skip if PotreeConverter not installed)
        potree_output="$POTREE_DIR/${base_name}"
        echo "Step 3/3: Converting COPC to Potree format..."
        if python3 "$SCRIPT_DIR/convert_to_potree.py" "$hdf_file" \
            -o "$POTREE_DIR" \
            --potree-path "$POTREE_CONVERTER" \
            --keep-intermediate 2>&1; then
            if [ -d "$potree_output" ]; then
                echo "SUCCESS: Created Potree format in $potree_output"
            else
                echo "WARNING: Potree conversion completed but directory not found"
            fi
        else
            echo "WARNING: Potree conversion skipped (PotreeConverter may not be installed)"
            echo "         COPC files are still available in $OUTPUT_DIR"
        fi

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
echo "Output files locations:"
echo "  COPC files: $OUTPUT_DIR"
echo "  Potree files: $POTREE_DIR"
echo ""

# List output files with sizes
echo "Generated COPC files:"
ls -lh "$OUTPUT_DIR"/*.copc.laz 2>/dev/null || echo "No COPC files generated"
echo ""

echo "Generated Potree directories:"
ls -d "$POTREE_DIR"/*/ 2>/dev/null || echo "No Potree directories generated"
echo ""

# Optional: Display file info using PDAL
echo "File information (first COPC file):"
FIRST_COPC=$(ls "$OUTPUT_DIR"/*.copc.laz 2>/dev/null | head -1)
if [ -f "$FIRST_COPC" ]; then
    pdal info "$FIRST_COPC" --summary
fi
