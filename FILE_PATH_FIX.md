# File Path Fix

## Problem

Error when loading COPC files:
```
Error: Invalid LAS file - signature mismatch
```

## Root Cause

1. **Incorrect file paths:** Configuration used `./data/` but files are in `./output/`
2. **Broken symbolic link:** `public/output` was pointing to `../../output` (wrong) instead of `../output` (correct)

## Solution

### 1. Fixed Symbolic Link

**Before:**
```bash
public/output -> ../../output  # Pointed to /Users/klesinger/github/deckGL/output (wrong!)
```

**After:**
```bash
public/output -> ../output     # Points to ./output (correct!)
```

**Command used:**
```bash
rm public/output
ln -s ../output public/output
```

### 2. Updated File Paths

**Before (fileSearch.ts):**
```typescript
const dataDirectory = './data'
```

**After:**
```typescript
const dataDirectory = '/output'  // Served via public/output symlink
```

## File Structure

```
callipsoVizCOPC/
├── public/
│   ├── output -> ../output    ✅ Symbolic link (fixed)
│   └── laz-perf.wasm
├── output/
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz  ✅ 73MB
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz  ✅ 57MB
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.copc.laz  ✅ 74MB
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.copc.laz  ✅ 57MB
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.copc.laz  ✅ 73MB
│   ├── CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.copc.laz  ✅ 56MB
│   └── CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.copc.laz  ✅ 74MB
└── src/
    └── utils/
        └── fileSearch.ts       ✅ Updated paths
```

## How Vite Serves Files

1. Files in `public/` folder are served at the root URL path
2. `public/output` symlink makes `./output/` files accessible at `/output/`
3. Web requests to `/output/file.copc.laz` serve from `./output/file.copc.laz`

## Verification

Files are now accessible at:
- `/output/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz`
- `/output/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz`
- etc.

## Testing

After the fix, the app should successfully:
1. Search for files based on date range and band type
2. Find matching files in the configured list
3. Load files when spatial bounds filter is applied
4. Display COPC data with octree optimization

## If You Add More Files

1. Place `.copc.laz` files in `./output/` directory
2. Update `src/utils/fileSearch.ts` → `getAvailableFileList()` to include new files
3. Files will automatically be served via the symlink

## Troubleshooting

### Files still not loading?

1. **Check symlink:**
   ```bash
   ls -la public/output
   # Should show: public/output -> ../output
   ```

2. **Verify files exist:**
   ```bash
   ls -lh output/*.copc.laz
   ```

3. **Check browser console** for 404 errors

4. **Clear browser cache:** Hard refresh (Ctrl+F5 / Cmd+Shift+R)

### Permission issues?

Make sure files are readable:
```bash
chmod +r output/*.copc.laz
```

### Symlink broken after git clone?

Recreate the symlink:
```bash
cd public
rm output
ln -s ../output output
```

## Summary

✅ Symbolic link fixed: `public/output -> ../output`
✅ File paths updated: `/output/` instead of `./data/`
✅ All 7 COPC files accessible
✅ File sizes verified (56-74 MB each)

The app should now successfully load COPC files!
