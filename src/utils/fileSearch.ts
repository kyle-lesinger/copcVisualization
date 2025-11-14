import { BandType } from '../App'

/**
 * File search result containing found files and metadata
 */
export interface FileSearchResult {
  files: string[]
  searchPattern: string
  bandType: BandType
  startDate: Date
  endDate: Date
  foundCount: number
}

/**
 * Configuration for file search
 */
export interface FileSearchConfig {
  baseDirectory?: string // Base directory or S3 bucket URL
  apiEndpoint?: string   // API endpoint for file listing
  fileList?: string[]    // Predefined list of files to search through
}

/**
 * Search for CALIPSO Potree directories matching date range and band type
 *
 * This function can work with three different file sources:
 * 1. API endpoint (queries backend for file list)
 * 2. Predefined file list (searches through provided array)
 * 3. Direct directory listing (if supported by environment)
 */
export async function searchCalipsoFiles(
  bandType: BandType,
  startDate: string,  // ISO datetime: YYYY-MM-DDTHH:mm:ss
  endDate: string,
  config: FileSearchConfig = {}
): Promise<FileSearchResult> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('[FileSearch] 🔍 SEARCHING FOR POTREE DIRECTORIES')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const start = new Date(startDate)
  const end = new Date(endDate)

  console.log(`[FileSearch] 📅 Date range: ${start.toLocaleString()} to ${end.toLocaleString()}`)
  console.log(`[FileSearch] 🌓 Band type: ${bandType}`)

  // Generate search pattern
  const searchPattern = generateSearchPattern(bandType, start, end)
  console.log(`[FileSearch] 🔎 Search pattern: ${searchPattern}`)

  // Perform search based on available configuration
  let foundFiles: string[] = []

  if (config.apiEndpoint) {
    foundFiles = await searchViaAPI(config.apiEndpoint, bandType, start, end)
  } else if (config.fileList) {
    foundFiles = searchInFileList(config.fileList, bandType, start, end)
  } else if (config.baseDirectory) {
    // For future implementation: search in directory or S3 bucket
    console.warn('[FileSearch] ⚠️  Directory search not yet implemented')
    foundFiles = []
  } else {
    console.warn('[FileSearch] ⚠️  No file source configured. Please provide apiEndpoint, fileList, or baseDirectory')
    foundFiles = []
  }

  // Log results
  console.log(`\n[FileSearch] ✅ SEARCH COMPLETE`)
  console.log(`[FileSearch] 📊 Found ${foundFiles.length} matching files`)

  if (foundFiles.length > 0) {
    console.log(`\n[FileSearch] 📁 Matching files:`)
    foundFiles.slice(0, 10).forEach((file, idx) => {
      const filename = file.split('/').pop() || file
      console.log(`  ${idx + 1}. ${filename}`)
    })
    if (foundFiles.length > 10) {
      console.log(`  ... and ${foundFiles.length - 10} more files`)
    }
    console.log(`\n[FileSearch] 💾 Files stored in memory for spatial filtering`)
    console.log(`[FileSearch] 🗺️  When spatial bounds filter is applied, these files will be loaded`)
  } else {
    console.log(`\n[FileSearch] ❌ No files found matching the criteria`)
    console.log(`[FileSearch] 💡 Tips:`)
    console.log(`  • Check date range matches available data`)
    console.log(`  • Verify band type selection (Day/Night)`)
    console.log(`  • Ensure file source is configured correctly`)
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  return {
    files: foundFiles,
    searchPattern,
    bandType,
    startDate: start,
    endDate: end,
    foundCount: foundFiles.length
  }
}

/**
 * Generate search pattern based on band type and date range
 */
function generateSearchPattern(bandType: BandType, startDate: Date, endDate: Date): string {
  const basePattern = 'CAL_LID_L1-Standard-V4-51'

  // Format date range for pattern
  const startStr = formatDateForPattern(startDate)
  const endStr = formatDateForPattern(endDate)

  let bandPattern: string
  switch (bandType) {
    case 'day':
      bandPattern = 'ZD'
      break
    case 'night':
      bandPattern = 'ZN'
      break
    case 'all':
      bandPattern = 'Z[DN]'
      break
  }

  if (startStr === endStr) {
    return `${basePattern}.${startStr}*${bandPattern}` // Potree directory names
  } else {
    return `${basePattern}.{${startStr}..${endStr}}*${bandPattern}` // Potree directory names
  }
}

/**
 * Format date for filename pattern: YYYY-MM-DD
 */
function formatDateForPattern(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Search via API endpoint
 */
async function searchViaAPI(
  apiEndpoint: string,
  bandType: BandType,
  startDate: Date,
  endDate: Date
): Promise<string[]> {
  console.log(`[FileSearch] 🌐 Querying API: ${apiEndpoint}`)

  try {
    const params = new URLSearchParams({
      bandType,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    })

    const response = await fetch(`${apiEndpoint}?${params}`)

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    return data.files || []
  } catch (error) {
    console.error(`[FileSearch] ❌ API request failed:`, error)
    return []
  }
}

/**
 * Search in predefined file list
 */
function searchInFileList(
  fileList: string[],
  bandType: BandType,
  startDate: Date,
  endDate: Date
): string[] {
  console.log(`[FileSearch] 📋 Searching through ${fileList.length} available Potree directories`)
  console.log(`[FileSearch] 📁 File source: Configured file list (see getAvailableFileList() in fileSearch.ts)`)
  console.log(`[FileSearch] 💡 To search different files, update getAvailableFileList() in src/utils/fileSearch.ts`)

  const results: string[] = []

  for (const filepath of fileList) {
    // For flat structure, we need to check the metadata.json to get the actual filename
    // For now, we'll use a simple approach: check if this is a direct path to potree_data_test
    if (filepath.endsWith('potree_data_test') || filepath === '/potree_data_test') {
      // Flat structure - check metadata to determine if it matches
      // For now, accept all flat structure directories since we'll validate via metadata
      console.log(`[FileSearch] ✓ Found flat structure Potree directory: ${filepath}`)
      console.log(`[FileSearch] ℹ️  Flat structure detected - will validate via metadata.json`)
      results.push(filepath)
      continue
    }

    // Standard directory-based structure
    const dirname = filepath.split('/').pop() || filepath

    // Check if directory name matches CALIPSO pattern
    if (!dirname.startsWith('CAL_LID_L1-Standard-V4-51')) {
      continue
    }

    // Extract date and band from directory name
    // Format: CAL_LID_L1-Standard-V4-51.2023-06-30T16-44-43ZD (Potree directory)
    const match = dirname.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z([DN])/)
    if (!match) {
      continue
    }

    const [, dateStr, hours, minutes, seconds, band] = match

    // Check band type
    if (bandType === 'day' && band !== 'D') continue
    if (bandType === 'night' && band !== 'N') continue

    // Parse file date
    const fileDate = new Date(`${dateStr}T${hours}:${minutes}:${seconds}`)

    // Check if file date is within range
    if (fileDate >= startDate && fileDate <= endDate) {
      results.push(filepath)
    }
  }

  return results
}

/**
 * Parse CALIPSO filename to extract metadata
 */
export function parseCalipsoFilename(filename: string): {
  date: Date
  band: 'D' | 'N'
  version: string
} | null {
  const match = filename.match(/CAL_LID_L1-Standard-(V[\d-]+)\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z([DN])/)

  if (!match) {
    return null
  }

  const [, version, dateStr, hours, minutes, seconds, band] = match

  return {
    date: new Date(`${dateStr}T${hours}:${minutes}:${seconds}`),
    band: band as 'D' | 'N',
    version
  }
}

/**
 * Get available file list
 * IMPORTANT: Update this list to match your actual data directory
 *
 * In production, this should be replaced with:
 * - API endpoint that lists files from server
 * - S3 bucket listing
 * - Dynamic directory scan
 */
export function getAvailableFileList(): string[] {
  // CONFIGURE THIS: Update with your actual file paths
  // Using Potree format with FLAT structure (metadata.json in root, not in pointclouds/index/)
  // The converted Potree data is stored directly in potree_data_test/
  const dataDirectory = '/potree_data_test' // Potree data location (flat structure)

  return [
    `${dataDirectory}`, // Points directly to the Potree directory (flat structure)
    // Add more Potree directories here as needed
  ]
}

/**
 * @deprecated Use getAvailableFileList() instead
 */
export function getExampleFileList(): string[] {
  console.warn('[FileSearch] ⚠️  getExampleFileList() is deprecated. Use getAvailableFileList() instead.')
  return getAvailableFileList()
}
