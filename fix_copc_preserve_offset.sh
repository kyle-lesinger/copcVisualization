#!/bin/bash

# Fix COPC files with correct scale factors AND preserve original offsets
# This ensures coordinates stay in their proper geographic location

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
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.las"
  "potree_data/CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.las"
)

echo "========================================="
echo "COPC Fix: Correct scale + preserve offset"
echo "========================================="

for las_file in "${LAS_FILES[@]}"; do
  if [ ! -f "$las_file" ]; then
    echo "⚠️  Skipping $las_file (not found)"
    continue
  fi

  output_file="${las_file%.las}.copc.laz"

  echo ""
  echo "🔄 Processing: $las_file"

  # Extract original offset values
  METADATA=$($PDAL info "$las_file" --metadata 2>/dev/null)
  OFFSET_X=$(echo "$METADATA" | grep '"offset_x"' | head -1 | sed 's/.*: *\([^,]*\).*/\1/')
  OFFSET_Y=$(echo "$METADATA" | grep '"offset_y"' | head -1 | sed 's/.*: *\([^,]*\).*/\1/')
  OFFSET_Z=$(echo "$METADATA" | grep '"offset_z"' | head -1 | sed 's/.*: *\([^,]*\).*/\1/')

  echo "   Original offsets: [$OFFSET_X, $OFFSET_Y, $OFFSET_Z]"

  # Restore from backup if it exists
  if [ -f "${output_file}.backup" ]; then
    rm -f "$output_file"
  fi

  # Convert with correct scale AND original offsets
  $PDAL translate "$las_file" "$output_file" \
    --writers.copc.scale_x=0.0000001 \
    --writers.copc.scale_y=0.0000001 \
    --writers.copc.scale_z=0.001 \
    --writers.copc.offset_x="$OFFSET_X" \
    --writers.copc.offset_y="$OFFSET_Y" \
    --writers.copc.offset_z="$OFFSET_Z" \
    2>&1 | grep -v "Global encoding WKT"

  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "   ✅ Success! Scale=1e-7, offsets preserved"
  else
    echo "   ❌ Failed!"
  fi
done

echo ""
echo "========================================="
echo "Verification"
echo "========================================="
echo "Checking first file..."
$PDAL info output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz --metadata 2>/dev/null | grep -E "(offset_|scale_)" | head -6

echo ""
echo "All done! Refresh your browser to see the data."
