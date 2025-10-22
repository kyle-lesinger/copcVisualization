/**
 * Color map utilities for scientific data visualization
 */

export type Colormap = 'viridis' | 'plasma' | 'turbo' | 'coolwarm' | 'jet' | 'grayscale'

/**
 * Apply a colormap to a normalized value (0-1)
 * @param t Normalized value between 0 and 1
 * @param colormap Name of the colormap to use
 * @returns RGB color as [r, g, b] where each component is 0-255
 */
export function applyColormap(t: number, colormap: Colormap): [number, number, number] {
  // Clamp t to [0, 1]
  t = Math.max(0, Math.min(1, t))

  switch (colormap) {
    case 'viridis':
      return viridis(t)
    case 'plasma':
      return plasma(t)
    case 'turbo':
      return turbo(t)
    case 'coolwarm':
      return coolwarm(t)
    case 'jet':
      return jet(t)
    case 'grayscale':
      return grayscale(t)
    default:
      return viridis(t)
  }
}

/**
 * Viridis colormap - perceptually uniform, colorblind-friendly
 */
function viridis(t: number): [number, number, number] {
  const r = 0.282 * (1 - t) + 0.993 * t
  const g = 0.140 * (1 - t) + 0.906 * t
  const b = 0.457 * (1 - t) + 0.144 * t

  // Apply correction for better color distribution
  const r2 = Math.sqrt(r) * 0.85
  const g2 = Math.sqrt(g) * 0.95
  const b2 = Math.pow(b, 0.7)

  return [
    Math.floor(255 * r2),
    Math.floor(255 * g2),
    Math.floor(255 * b2)
  ]
}

/**
 * Plasma colormap - perceptually uniform, high contrast
 */
function plasma(t: number): [number, number, number] {
  const r = 0.050 + 0.900 * t
  const g = 0.030 + 0.350 * Math.sin(Math.PI * t)
  const b = 0.527 - 0.400 * t

  return [
    Math.floor(255 * Math.pow(r, 0.85)),
    Math.floor(255 * Math.pow(g, 0.9)),
    Math.floor(255 * Math.pow(b, 0.8))
  ]
}

/**
 * Turbo colormap - high dynamic range, vivid colors
 */
function turbo(t: number): [number, number, number] {
  const r = Math.sqrt(Math.abs(Math.sin(2.4 * Math.PI * (t - 0.25))))
  const g = Math.pow(Math.sin(Math.PI * t), 1.5)
  const b = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + 0.25))

  return [
    Math.floor(255 * r),
    Math.floor(255 * g),
    Math.floor(255 * b)
  ]
}

/**
 * Cool-Warm diverging colormap - great for showing deviations
 */
function coolwarm(t: number): [number, number, number] {
  // Blue (cool) at 0, Red (warm) at 1
  const r = 0.230 + 0.770 * t
  const g = 0.299 + 0.701 * (0.5 - Math.abs(t - 0.5)) * 2
  const b = 0.754 - 0.754 * t

  return [
    Math.floor(255 * r),
    Math.floor(255 * g),
    Math.floor(255 * b)
  ]
}

/**
 * Jet colormap - classic rainbow colors (not recommended for scientific viz)
 */
function jet(t: number): [number, number, number] {
  let r, g, b

  if (t < 0.125) {
    r = 0
    g = 0
    b = 0.5 + 0.5 * (t / 0.125)
  } else if (t < 0.375) {
    r = 0
    g = (t - 0.125) / 0.25
    b = 1
  } else if (t < 0.625) {
    r = (t - 0.375) / 0.25
    g = 1
    b = 1 - (t - 0.375) / 0.25
  } else if (t < 0.875) {
    r = 1
    g = 1 - (t - 0.625) / 0.25
    b = 0
  } else {
    r = 1 - 0.5 * (t - 0.875) / 0.125
    g = 0
    b = 0
  }

  return [
    Math.floor(255 * r),
    Math.floor(255 * g),
    Math.floor(255 * b)
  ]
}

/**
 * Grayscale colormap - simple linear grayscale
 */
function grayscale(t: number): [number, number, number] {
  const value = Math.floor(255 * t)
  return [value, value, value]
}

/**
 * Get a human-readable name for a colormap
 */
export function getColormapName(colormap: Colormap): string {
  const names: Record<Colormap, string> = {
    viridis: 'Viridis',
    plasma: 'Plasma',
    turbo: 'Turbo',
    coolwarm: 'Cool-Warm',
    jet: 'Jet',
    grayscale: 'Grayscale'
  }
  return names[colormap]
}
