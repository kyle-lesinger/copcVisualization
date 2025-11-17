/**
 * Format Detection Utility
 *
 * Detects whether a point cloud file/URL is COPC or Potree format
 */

export type PointCloudFormat = 'copc' | 'potree'

/**
 * Detect the format of a point cloud file or directory
 *
 * @param url - URL or path to the point cloud file/directory
 * @returns Promise resolving to 'copc' or 'potree'
 */
export async function detectPointCloudFormat(url: string): Promise<PointCloudFormat> {
  // Check file extension first (fastest check)
  if (url.endsWith('.copc.laz') || url.endsWith('.laz') || url.endsWith('.las')) {
    console.log(`[FormatDetection] Detected COPC format from extension: ${url}`)
    return 'copc'
  }

  // Check if URL points to a directory (Potree format)
  // Potree format has metadata.json in the directory
  try {
    const metadataUrl = url.endsWith('/') ? `${url}metadata.json` : `${url}/metadata.json`
    console.log(`[FormatDetection] Checking for Potree metadata: ${metadataUrl}`)

    const response = await fetch(metadataUrl, {
      method: 'HEAD',
      // Use a short timeout to fail fast
      signal: AbortSignal.timeout(5000)
    })

    if (response.ok) {
      console.log(`[FormatDetection] Found Potree metadata.json, detected Potree format`)
      return 'potree'
    }
  } catch (error) {
    console.log(`[FormatDetection] No Potree metadata found:`, error)
  }

  // Default to COPC if we can't determine
  console.log(`[FormatDetection] Defaulting to COPC format for: ${url}`)
  return 'copc'
}

/**
 * Check if a URL is a Potree directory
 *
 * @param url - URL to check
 * @returns Promise resolving to true if it's a valid Potree directory
 */
export async function isPotreeDirectory(url: string): Promise<boolean> {
  try {
    const metadataUrl = url.endsWith('/') ? `${url}metadata.json` : `${url}/metadata.json`
    const response = await fetch(metadataUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Check if a URL is a COPC/LAZ file
 *
 * @param url - URL to check
 * @returns boolean indicating if it's a COPC/LAZ file
 */
export function isCOPCFile(url: string): boolean {
  return url.endsWith('.copc.laz') || url.endsWith('.laz') || url.endsWith('.las')
}

/**
 * Get the base URL for a Potree directory
 * Ensures the URL ends with a slash
 *
 * @param url - Potree directory URL
 * @returns URL with trailing slash
 */
export function getPotreeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
