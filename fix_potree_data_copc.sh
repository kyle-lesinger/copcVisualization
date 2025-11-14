#!/bin/bash

# Fix COPC files in potree_data directory

PDAL="/opt/anaconda3/envs/pdal/bin/pdal"

# Array of LAS files in potree_data to convert
LAS_FILES=(
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.las"
)

echo "========================================="
echo "Fixing potree_data COPC files"
echo "========================================="

for las_file in "${LAS_FILES[@]}"; do
  if [ ! -f "$las_file" ]; then
    echo "⚠️  Skipping $las_file (not found)"
    continue
  fi

  output_file="${las_file%.las}.copc.laz"

  echo "🔄 Converting: $las_file"

  # Backup old file
  if [ -f "$output_file" ]; then
    mv "$output_file" "${output_file}.backup"
  fi

  # Convert with correct scale factors
  $PDAL translate "$las_file" "$output_file" \
    --writers.copc.scale_x=0.0000001 \
    --writers.copc.scale_y=0.0000001 \
    --writers.copc.scale_z=0.001

  if [ $? -eq 0 ]; then
    echo "   ✅ Success!"
  else
    echo "   ❌ Failed!"
    if [ -f "${output_file}.backup" ]; then
      mv "${output_file}.backup" "$output_file"
    fi
  fi
  echo ""
done

echo "========================================="
echo "Done!"
echo "========================================="
