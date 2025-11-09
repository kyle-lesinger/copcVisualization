import * as THREE from 'three'
import { PointCloudData } from './copcLoader'

/**
 * Simple LOD manager that creates multiple detail levels from existing data
 */
export class SimpleLODManager {
  private lodLevels: THREE.LOD[] = []
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /**
   * Create LOD levels for a point cloud dataset
   */
  createLODForData(
    data: PointCloudData,
    pointSize: number,
    createGeometry: (decimation: number) => { positions: Float32Array, colors: Uint8Array }
  ): THREE.LOD {
    const lod = new THREE.LOD()

    // LOD Level 0: High detail (every 5th point) - close distance
    const high = this.createPoints(createGeometry(5), pointSize)
    lod.addLevel(high, 0)

    // LOD Level 1: Medium detail (every 20th point) - medium distance
    const medium = this.createPoints(createGeometry(20), pointSize)
    lod.addLevel(medium, 0.5)

    // LOD Level 2: Low detail (every 50th point) - far distance
    const low = this.createPoints(createGeometry(50), pointSize)
    lod.addLevel(low, 1.5)

    // LOD Level 3: Very low detail (every 200th point) - very far
    const veryLow = this.createPoints(createGeometry(200), pointSize)
    lod.addLevel(veryLow, 3.0)

    this.scene.add(lod)
    this.lodLevels.push(lod)

    return lod
  }

  /**
   * Create Three.js Points from position and color data
   */
  private createPoints(data: { positions: Float32Array, colors: Uint8Array }, pointSize: number): THREE.Points {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true)) // normalized

    const material = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: true
    })

    return new THREE.Points(geometry, material)
  }

  /**
   * Update point size for all LOD levels
   */
  updatePointSize(size: number): void {
    this.lodLevels.forEach(lod => {
      lod.children.forEach(child => {
        if (child instanceof THREE.Points && child.material instanceof THREE.PointsMaterial) {
          child.material.size = size
        }
      })
    })
  }

  /**
   * Update colors for all LOD levels
   */
  updateColors(createGeometry: (decimation: number) => { positions: Float32Array, colors: Uint8Array }): void {
    this.lodLevels.forEach((lod, index) => {
      // Update each LOD level with new colors
      const decimations = [5, 20, 50, 200]
      lod.children.forEach((child, levelIndex) => {
        if (child instanceof THREE.Points) {
          const newData = createGeometry(decimations[levelIndex])
          const colorAttribute = child.geometry.getAttribute('color') as THREE.BufferAttribute
          if (colorAttribute) {
            colorAttribute.array = newData.colors
            colorAttribute.needsUpdate = true
          }
        }
      })
    })
  }

  /**
   * Remove all LOD levels from scene
   */
  dispose(): void {
    this.lodLevels.forEach(lod => {
      lod.children.forEach(child => {
        if (child instanceof THREE.Points) {
          child.geometry.dispose()
          if (child.material instanceof THREE.Material) {
            child.material.dispose()
          }
        }
      })
      this.scene.remove(lod)
    })
    this.lodLevels = []
  }

  /**
   * Get all LOD objects
   */
  getLODs(): THREE.LOD[] {
    return this.lodLevels
  }
}

/**
 * Decimate point cloud data by taking every Nth point
 */
export function decimatePointData(
  positions: Float32Array,
  colors: Uint8Array,
  decimation: number
): { positions: Float32Array, colors: Uint8Array } {
  const pointCount = positions.length / 3
  const decimatedCount = Math.floor(pointCount / decimation)

  const decimatedPositions = new Float32Array(decimatedCount * 3)
  const decimatedColors = new Uint8Array(decimatedCount * 3)

  let writeIndex = 0
  for (let i = 0; i < pointCount; i++) {
    if (i % decimation !== 0) continue

    // Copy position
    decimatedPositions[writeIndex * 3] = positions[i * 3]
    decimatedPositions[writeIndex * 3 + 1] = positions[i * 3 + 1]
    decimatedPositions[writeIndex * 3 + 2] = positions[i * 3 + 2]

    // Copy color
    decimatedColors[writeIndex * 3] = colors[i * 3]
    decimatedColors[writeIndex * 3 + 1] = colors[i * 3 + 1]
    decimatedColors[writeIndex * 3 + 2] = colors[i * 3 + 2]

    writeIndex++
  }

  return {
    positions: decimatedPositions,
    colors: decimatedColors
  }
}
