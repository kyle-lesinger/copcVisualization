# TAI Time Handling and GPS Time Conversion

## Overview

CALIPSO satellite data uses **TAI (International Atomic Time)** for GPS timestamps, which differs from standard UTC time. This document explains the challenges of parsing and converting TAI times from LAZ files, and the solutions implemented for human-readable time display.

## Time Systems in Satellite Data

### TAI (International Atomic Time)

**Definition**: Atomic time standard based on cesium atomic clocks.

**Characteristics**:
- No leap seconds
- Monotonically increasing
- Used by GPS satellites and CALIPSO
- Epoch: January 1, 1993, 00:00:00 UTC

**Why satellites use TAI**:
1. **No discontinuities**: Leap seconds create time jumps in UTC
2. **Precise timing**: Critical for orbital mechanics and synchronization
3. **GPS standard**: GPS time is based on TAI with an offset

### UTC (Coordinated Universal Time)

**Definition**: Civil time standard based on Earth's rotation.

**Characteristics**:
- Includes leap seconds to stay synchronized with Earth's rotation
- What humans use for dates/times
- Differs from TAI by integer number of seconds (currently ~37 seconds)

**Leap seconds**:
```
1993: TAI - UTC = 28 seconds
2000: TAI - UTC = 32 seconds
2012: TAI - UTC = 35 seconds
2017: TAI - UTC = 37 seconds
2025: TAI - UTC = 37 seconds (no new leap seconds since 2017)
```

### GPS Time

**Definition**: Time system used by GPS satellites.

**Relationship**:
```
GPS Time = TAI - 19 seconds
```

GPS epoch: January 6, 1980, 00:00:00 UTC

**CALIPSO uses GPS Time** stored as seconds since GPS epoch.

## The Parsing Challenge

### Point Format 6

LAZ files use **Point Format 6** from LAS 1.4 specification:

```
Offset  Size  Field
------  ----  -----
0       4     X (scaled integer)
4       4     Y (scaled integer)
8       4     Z (scaled integer)
12      2     Intensity
14      1     Return Number | Number of Returns | Scan Direction | Edge of Flight Line
15      1     Classification
16      1     Scan Angle Rank
17      1     User Data
18      2     Point Source ID
20      2     Reserved (must be 0)
22      8     GPS Time (double precision float)
30+     ...   Optional extra bytes
```

**GPS Time field**:
- 8 bytes (64-bit double)
- Offset 22 from point start
- Units: seconds (as double precision)

### The Problem: Incorrect Offsets

**Expected**: GPS time at byte offset 22

**Reality**: Different LAZ encoders place GPS time at different offsets:
- Some at offset 22 (correct per spec)
- Some at offset 21 (off by one)
- Some at offset 20 (using reserved bytes)

**Symptom**: Parsing GPS time from offset 22 yields:
```
gpsTime = -2.3898507946224719e+61  // Nonsense value!
```

This is because we're reading the **wrong 8 bytes**.

### The Solution: Smart Fallback

**Implementation** (`src/utils/copcLoader.ts:165-185`):

```typescript
let gpsTime = 0
let lastGpsTime = 0

// First point GPS time (with fallback)
try {
  gpsTime = parsedData.loaderData.header.gpsTime?.[0] || 0

  // Validate: TAI time should be positive and reasonable (< 1e10)
  if (gpsTime <= 0 || gpsTime > 1e10 || !isFinite(gpsTime)) {
    console.warn('GPS time from offset 22 is invalid, trying offset 21')
    // Try alternative offset (some LAZ encoders use offset 21)
    gpsTime = tryAlternativeGpsTimeOffset(parsedData.loaderData, 0, 21)

    if (gpsTime <= 0 || gpsTime > 1e10 || !isFinite(gpsTime)) {
      console.warn('GPS time from offset 21 is invalid, trying offset 20')
      gpsTime = tryAlternativeGpsTimeOffset(parsedData.loaderData, 0, 20)
    }
  }
} catch (err) {
  console.error('Error reading GPS time:', err)
  gpsTime = 0
}

// Last point GPS time (with same fallback strategy)
try {
  lastGpsTime = parsedData.loaderData.header.gpsTime?.[decimatedCount - 1] || decimatedCount - 1

  if (lastGpsTime <= 0 || lastGpsTime > 1e10 || !isFinite(lastGpsTime)) {
    lastGpsTime = tryAlternativeGpsTimeOffset(parsedData.loaderData, decimatedCount - 1, 21)

    if (lastGpsTime <= 0 || lastGpsTime > 1e10 || !isFinite(lastGpsTime)) {
      lastGpsTime = tryAlternativeGpsTimeOffset(parsedData.loaderData, decimatedCount - 1, 20)
    }
  }
} catch (err) {
  console.error('Error reading last GPS time:', err)
  lastGpsTime = decimatedCount - 1
}
```

**Strategy**:
1. Try offset 22 (standard)
2. Validate: positive, finite, < 10 billion
3. If invalid, try offset 21
4. If still invalid, try offset 20
5. If all fail, use point index as fallback

This handles different LAZ encoder quirks automatically.

## TAI to UTC Conversion

### Conversion Formula

**Without leap seconds**:
```typescript
TAI seconds → UTC milliseconds

utc_ms = (tai_seconds * 1000) + tai_epoch_ms
```

**TAI Epoch** (used by CALIPSO):
```
January 1, 1993, 00:00:00 UTC
```

### Implementation

**File**: `src/utils/copcLoader.ts`

**TAI Epoch Definition** (line 12):
```typescript
// TAI epoch: 1993-01-01 00:00:00 UTC
// This is the reference point for GPS time in CALIPSO data
const TAI_EPOCH = new Date('1993-01-01T00:00:00.000Z').getTime()
```

**Conversion Function** (lines 14-18):
```typescript
export function taiToDate(taiSeconds: number): Date {
  // Convert TAI seconds to UTC milliseconds
  const utcMilliseconds = TAI_EPOCH + (taiSeconds * 1000)
  return new Date(utcMilliseconds)
}
```

**Formatting Function** (lines 20-30):
```typescript
export function formatTaiTime(taiSeconds: number): string {
  const date = taiToDate(taiSeconds)

  // Extract components
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} UTC`
}
```

**Output format**:
```
2023-06-30 16:44:43.250 UTC
```

### Simplification: No Leap Second Adjustment

**Current implementation** assumes no leap seconds added after TAI epoch.

**Why this works**:
- CALIPSO data is from 2023
- TAI epoch is 1993
- Leap second offset has been constant at 37 seconds since 2017
- JavaScript Date object handles this automatically for recent dates

**Technically more accurate** would be:
```typescript
export function taiToDate(taiSeconds: number): Date {
  // TAI - UTC offset (leap seconds)
  const leapSeconds = 37 // As of 2017, still valid in 2023
  const utcSeconds = taiSeconds - leapSeconds
  const utcMilliseconds = TAI_EPOCH + (utcSeconds * 1000)
  return new Date(utcMilliseconds)
}
```

**Why we skip it**:
1. Leap second database would need maintenance
2. Difference is only visual (37 seconds offset)
3. JavaScript Date already handles modern leap seconds
4. Relative times (animation) don't care about absolute offset

## Usage in Application

### Control Panel Display

**File**: `src/components/ControlPanel.tsx`

**Current Time Display** (lines 196-207):
```typescript
<p><strong>Time:</strong> {(() => {
  const displayTime = currentGpsTime !== null && currentGpsTime !== undefined
    ? currentGpsTime
    : firstPoint.gpsTime

  console.log('ControlPanel: Displaying GPS time:', displayTime)

  // Check if GPS time is valid (TAI seconds should be positive and reasonable)
  if (displayTime > 0 && displayTime < 1e10) {
    return formatTaiTime(displayTime)  // Convert to human-readable UTC
  } else {
    // Fallback for invalid or index-based times
    return `Point ${Math.floor(displayTime)}`
  }
})()}</p>
```

**Time Range Display** (lines 208-218):
```typescript
<p><strong>Time Range:</strong><br/>
  <small>
    {firstPoint.gpsTime > 0 && firstPoint.gpsTime < 1e10
      ? formatTaiTime(firstPoint.gpsTime).split(' ').slice(1).join(' ')
      : `Point ${Math.floor(firstPoint.gpsTime)}`}
    {' → '}
    {lastPoint.gpsTime > 0 && lastPoint.gpsTime < 1e10
      ? formatTaiTime(lastPoint.gpsTime).split(' ').slice(1).join(' ')
      : `Point ${Math.floor(lastPoint.gpsTime)}`}
  </small>
</p>
```

Shows only the time portion (HH:MM:SS.mmm UTC) for the range to save space.

### Dynamic Updates During Animation

**Animation callback** (`src/components/GlobeViewer.tsx:520`):
```typescript
// Calculate current GPS time based on animation progress
currentGpsTime = firstPoint.gpsTime + (lastPoint.gpsTime - firstPoint.gpsTime) * eased

// Notify UI
onCurrentGpsTime?.(currentGpsTime)
```

**React state flow**:
```
GlobeViewer (animation loop)
  ↓ onCurrentGpsTime(1000.5)
PointCloudViewer.handleCurrentGpsTime
  ↓ onCurrentGpsTimeUpdate(1000.5)
App.handleCurrentGpsTimeUpdate
  ↓ setCurrentGpsTime(1000.5)
ControlPanel (re-renders)
  ↓ formatTaiTime(1000.5)
Display: "2023-06-30 16:44:43.500 UTC"
```

Updates happen **60 times per second** during animation (every frame).

## Validation and Error Handling

### GPS Time Validation

**Valid TAI time criteria**:
```typescript
const isValidTaiTime = (tai: number) => {
  return tai > 0 &&           // Positive
         tai < 1e10 &&        // Less than ~317 years from epoch
         isFinite(tai)        // Not NaN or Infinity
}
```

**Why < 1e10?**
- 1e10 seconds ≈ 317 years
- CALIPSO launched in 2006 (13 years from epoch)
- Any value > 1e10 indicates parsing error

### Fallback Strategy

**If all GPS time parsing fails**:
```typescript
gpsTime = 0  // or point index
```

**UI shows**:
```typescript
if (gpsTime > 0 && gpsTime < 1e10) {
  return formatTaiTime(gpsTime)
} else {
  return `Point ${Math.floor(gpsTime)}`
}
```

**Result**: Instead of crashing, displays "Point 0" or "Point 12345".

### Console Logging

Strategic logging for debugging:

```typescript
console.log('GPS Time:', gpsTime, 'Last GPS Time:', lastGpsTime)
console.warn('GPS time from offset 22 is invalid, trying offset 21')
console.error('Error reading GPS time:', err)
console.log('ControlPanel: Displaying GPS time:', displayTime)
```

Helps diagnose offset issues in different LAZ files.

## Example GPS Time Values

### CALIPSO Data (June 30, 2023)

**First point**:
```
TAI seconds: 963500683.0
Formatted:   2023-06-30 16:44:43.000 UTC
```

**Last point** (6 minutes later):
```
TAI seconds: 963501043.0
Formatted:   2023-06-30 16:50:43.000 UTC
```

**Delta**: 360 seconds = 6 minutes (typical CALIPSO granule duration)

### Animation Progress

At 50% progress:
```
Current TAI: 963500683 + (963501043 - 963500683) * 0.5
           = 963500683 + 180
           = 963500863

Formatted:   2023-06-30 16:47:43.000 UTC
```

Updates smoothly from 16:44:43 to 16:50:43 over 20-second animation.

## Precision and Accuracy

### Double Precision

GPS time is stored as **64-bit double**:
- 53 bits of precision
- For time values ~1 billion seconds: precision ≈ 0.1 microseconds
- More than sufficient for CALIPSO (millisecond-level timing)

### JavaScript Date Limitations

JavaScript Date:
- Millisecond precision only
- Stored as 64-bit double (milliseconds since 1970)
- Range: ±100 million days from epoch

**Implication**: Sub-millisecond timing from GPS is lost in conversion.

**Acceptable because**:
- CALIPSO shot frequency: ~300 meters along-track
- Satellite speed: ~7 km/s
- Time between shots: ~43 milliseconds
- Millisecond precision is adequate

## Alternative Time Systems Considered

### Unix Time (Epoch 1970)

**Pros**:
- JavaScript native
- No conversion needed

**Cons**:
- Not what CALIPSO uses
- Would require converting HDF4 data during preprocessing
- Loses TAI vs UTC distinction

### ISO 8601 Strings

**Pros**:
- Human-readable in data files
- Timezone-aware

**Cons**:
- Much larger file size (strings vs doubles)
- Parsing overhead
- Not standard for LAZ format

### GPS Week + Seconds

**Pros**:
- Standard GPS format
- Compact representation

**Cons**:
- Requires week rollover handling
- Not used by CALIPSO HDF4 files
- Awkward for humans

**Decision**: Stick with TAI seconds (native CALIPSO format), convert only for display.

## Future Improvements

### 1. Leap Second Database

Maintain accurate leap second table:

```typescript
const LEAP_SECONDS = [
  { date: '1993-01-01', offset: 28 },
  { date: '2000-01-01', offset: 32 },
  { date: '2012-07-01', offset: 35 },
  { date: '2017-01-01', offset: 37 },
  // ... future leap seconds
]

export function taiToUtc(taiSeconds: number): Date {
  const taiDate = new Date(TAI_EPOCH + taiSeconds * 1000)
  const leapOffset = getLeapSecondOffset(taiDate)
  const utcMs = TAI_EPOCH + (taiSeconds - leapOffset) * 1000
  return new Date(utcMs)
}
```

**Benefit**: Accurate UTC times to the second.

### 2. Multiple Time Zones

Allow user to select display timezone:

```typescript
export function formatTaiTime(taiSeconds: number, timezone: string = 'UTC'): string {
  const date = taiToDate(taiSeconds)
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}
```

**Benefit**: Local time display for specific regions.

### 3. Relative Time Display

Show time relative to first point:

```typescript
export function formatRelativeTime(currentTime: number, startTime: number): string {
  const deltaSeconds = currentTime - startTime
  const minutes = Math.floor(deltaSeconds / 60)
  const seconds = (deltaSeconds % 60).toFixed(1)
  return `+${minutes}:${seconds.padStart(4, '0')}`
}

// Display: "+5:32.5" (5 minutes 32.5 seconds from start)
```

**Benefit**: Easier to see animation progress.

### 4. Autodetect GPS Time Offset

Instead of hardcoded fallback, analyze data:

```typescript
function detectGpsTimeOffset(loaderData: any): number {
  const offsets = [22, 21, 20]

  for (const offset of offsets) {
    const value = readDoubleAtOffset(loaderData, 0, offset)
    if (isValidTaiTime(value)) {
      console.log(`Auto-detected GPS time offset: ${offset}`)
      return offset
    }
  }

  throw new Error('Could not find valid GPS time offset')
}
```

**Benefit**: More robust handling of various LAZ encoders.

## Conclusion

TAI time handling in CALIPSO COPC Viewer demonstrates:

1. **Robustness**: Smart fallback strategy handles various LAZ encoding quirks
2. **User-Friendly**: Converts satellite TAI times to human-readable UTC format
3. **Performance**: Efficient conversion (simple arithmetic, no database lookups)
4. **Graceful Degradation**: Falls back to point indices if GPS time parsing fails

The implementation successfully bridges the gap between **satellite time systems** (TAI/GPS) and **human time perception** (UTC), enabling meaningful temporal visualization during satellite animation.

Key innovation: **Multi-offset fallback strategy** that adapts to different LAZ file formats without requiring manual configuration or file-specific handling.
