#!/bin/bash

# Script to recreate COPC files with correct scale factors
# Problem: Current files have scale_x/y = 0.0001 (too coarse, causes quantization)
# Solution: Recreate with scale_x/y = 0.0000001 (1cm precision)

PDAL="/opt/anaconda3/envs/pdal/bin/pdal"

# Array of LAS files to convert
LAS_FILES=(
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.las"
  "output/CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.las"
  "output/tiled/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_south.las"
  "output/tiled/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_south_mid.las"
  "output/tiled/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_north_mid.las"
  "output/tiled/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD_tile_north.las"
)

echo "========================================="
echo "COPC Scale Factor Fix"
echo "========================================="
echo "Converting ${#LAS_FILES[@]} files with correct scale factors:"
echo "  scale_x = 0.0000001 (1e-7)"
echo "  scale_y = 0.0000001 (1e-7)"
echo "  scale_z = 0.001"
echo ""

for las_file in "${LAS_FILES[@]}"; do
  if [ ! -f "$las_file" ]; then
    echo "⚠️  Skipping $las_file (not found)"
    continue
  fi

  # Generate output filename (replace .las with .copc.laz)
  output_file="${las_file%.las}.copc.laz"

  echo "🔄 Converting: $las_file"
  echo "   → $output_file"

  # Backup old COPC file if it exists
  if [ -f "$output_file" ]; then
    backup_file="${output_file}.backup"
    echo "   📦 Backing up old file to: $backup_file"
    mv "$output_file" "$backup_file"
  fi

  # Run PDAL translate with correct scale factors
  $PDAL translate "$las_file" "$output_file" \
    --writers.copc.scale_x=0.0000001 \
    --writers.copc.scale_y=0.0000001 \
    --writers.copc.scale_z=0.001

  if [ $? -eq 0 ]; then
    echo "   ✅ Success!"
  else
    echo "   ❌ Failed!"
    # Restore backup if conversion failed
    if [ -f "${output_file}.backup" ]; then
      mv "${output_file}.backup" "$output_file"
      echo "   ↩️  Restored backup"
    fi
  fi
  echo ""
done

echo "========================================="
echo "Conversion complete!"
echo "========================================="
echo ""
echo "To verify the fix, run:"
echo "$PDAL info output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz --metadata | grep scale"
