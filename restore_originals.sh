#!/bin/bash

echo "Restoring original COPC files from backups..."

# Restore output/ directory
for file in output/*.copc.laz.backup; do
  if [ -f "$file" ]; then
    original="${file%.backup}"
    cp "$file" "$original"
    echo "Restored: $original"
  fi
done

# Restore output/tiled/ directory
for file in output/tiled/*.copc.laz.backup; do
  if [ -f "$file" ]; then
    original="${file%.backup}"
    cp "$file" "$original"
    echo "Restored: $original"
  fi
done

# Restore potree_data/ directory
for file in potree_data/*.copc.laz.backup; do
  if [ -f "$file" ]; then
    original="${file%.backup}"
    cp "$file" "$original"
    echo "Restored: $original"
  fi
done

echo ""
echo "Verification - checking scale/offset of restored file:"
/opt/anaconda3/envs/pdal/bin/pdal info output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz --metadata 2>/dev/null | grep -E "(offset_|scale_)" | head -6

echo ""
echo "All original COPC files restored!"
echo "Refresh your browser to see the data."
