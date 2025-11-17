# File Configuration Guide

## Overview

The CALIPSO COPC Viewer searches for files based on date range and band type filters. You need to configure which files are available for searching.

## Current Configuration

The file list is configured in: `src/utils/fileSearch.ts` → `getAvailableFileList()`

## How to Update Available Files

### Option 1: Manual File List (Current Setup)

Edit `src/utils/fileSearch.ts`:

```typescript
export function getAvailableFileList(): string[] {
  const dataDirectory = './data' // Update this path

  return [
    `${dataDirectory}/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz`,
    `${dataDirectory}/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz`,
    // Add more files here...
  ]
}
```

**Steps:**
1. Open `src/utils/fileSearch.ts`
2. Find the `getAvailableFileList()` function
3. Update `dataDirectory` to match your data location
4. Add/remove file paths as needed
5. Rebuild: `npm run build`

### Option 2: Generate File List from Directory (Recommended)

Create a script to automatically generate the file list:

```bash
# In your data directory, run:
ls *.copc.laz > filelist.txt

# Or with full paths:
find /path/to/data -name "*.copc.laz" > filelist.txt
```

Then use this list to update `getAvailableFileList()`.

### Option 3: API Endpoint (Production)

For production deployments, configure an API endpoint:

```typescript
const result = await searchCalipsoFiles(
  selectedBand,
  dateRangeFilter.startDate,
  dateRangeFilter.endDate,
  {
    apiEndpoint: 'https://your-api.com/list-files'
  }
)
```

The API should accept query parameters:
- `bandType`: 'all' | 'day' | 'night'
- `startDate`: ISO datetime string
- `endDate`: ISO datetime string

And return JSON:
```json
{
  "files": [
    "/data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz",
    ...
  ]
}
```

### Option 4: S3 Bucket Listing

For S3-hosted data, implement bucket listing:

```typescript
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3"

async function listS3Files(bucket: string, prefix: string) {
  const client = new S3Client({ region: 'us-east-1' })
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix
  })
  const response = await client.send(command)
  return response.Contents?.map(obj => obj.Key) || []
}
```

## Current File List

As of the last configuration, the following files are available:

```
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T19-15-53ZN.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T20-54-18ZN.copc.laz
./data/CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.copc.laz
```

**All files are from June 30, 2023**

## File Search Behavior

### When Searching for 2023-06-01

**Console Output:**
```
[FileSearch] 🔍 SEARCHING FOR CALIPSO FILES
[FileSearch] 📅 Date range: 6/1/2023 to 6/1/2023
[FileSearch] 📋 Searching through 7 available files
[FileSearch] ❌ No files found matching the criteria
```

**Why?** No files from June 1st exist in the configured list.

### When Searching for 2023-06-30 Day Band

**Console Output:**
```
[FileSearch] 🔍 SEARCHING FOR CALIPSO FILES
[FileSearch] 📅 Date range: 6/30/2023 to 6/30/2023
[FileSearch] 🌓 Band type: day
[FileSearch] ✅ SEARCH COMPLETE
[FileSearch] 📊 Found 4 matching files

[FileSearch] 📁 Matching files:
  1. CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz
  2. CAL_LID_L1-Standard-V4-51.2023-06-30T18-23-08ZD.copc.laz
  3. CAL_LID_L1-Standard-V4-51.2023-06-30T20-01-33ZD.copc.laz
  4. CAL_LID_L1-Standard-V4-51.2023-06-30T21-39-53ZD.copc.laz
```

**Why?** These 4 files are Day band (end with 'ZD') and match June 30, 2023.

## Verifying Configuration

To verify your file configuration is working:

1. **Open browser console** (F12 → Console)

2. **Apply date range filter** with a date that has files

3. **Look for file search logs:**
   ```
   [FileSearch] 📋 Searching through X available files
   [FileSearch] 📁 File source: Configured file list
   ```

4. **Check found files:**
   ```
   [FileSearch] 📊 Found X matching files
   [FileSearch] 📁 Matching files:
     1. filename.copc.laz
     ...
   ```

5. **If no files found:**
   - Check date range matches your files
   - Check band type matches (D=day, N=night)
   - Verify files are in `getAvailableFileList()`

## Troubleshooting

### "No files found matching the criteria"

**Causes:**
1. Date range doesn't match any files
2. Band type filter excludes files
3. Files not added to `getAvailableFileList()`

**Solutions:**
1. Check file dates in console logs
2. Try "All Bands" instead of Day/Night only
3. Add files to `getAvailableFileList()` in fileSearch.ts

### "File not loading" errors

**Causes:**
1. File path is incorrect
2. File doesn't exist at specified path
3. CORS issues (for remote files)

**Solutions:**
1. Verify file paths are correct (relative or absolute)
2. Check files exist: `ls -l data/*.copc.laz`
3. Configure CORS for S3/remote servers

### Files from wrong dates appearing

**Causes:**
1. Using old example file list
2. `getExampleFileList()` still being called

**Solutions:**
1. Ensure using `getAvailableFileList()` not `getExampleFileList()`
2. Clear browser cache and rebuild
3. Check App.tsx calls correct function

## File Naming Convention

CALIPSO files follow this pattern:
```
CAL_LID_L1-Standard-V4-51.YYYY-MM-DDTHH-MM-SSZB.copc.laz
                          └────┬────┘└──┬──┘└┬┘
                            Date     Time  Band
                                           D = Day
                                           N = Night
```

**Examples:**
- `CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD.copc.laz` → June 30, 2023, 16:44:43, Day
- `CAL_LID_L1-Standard-V4-51.2023-06-30T17-37-28ZN.copc.laz` → June 30, 2023, 17:37:28, Night

## Next Steps

After configuring files:

1. **Enable Date Range Filter** in UI
2. **Select appropriate date range** matching your files
3. **Choose band type** (All/Day/Night)
4. **Check console** for file search results
5. **Enable Spatial Bounds Filter** to load files
6. **Watch console** for COPC octree optimization logs

The files will be loaded with selective filtering based on your spatial bounds!
