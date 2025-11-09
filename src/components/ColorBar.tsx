import { useMemo, useRef, useEffect } from 'react'
import { Colormap, applyColormap } from '../utils/colormaps'
import './ColorBar.css'

interface ColorBarProps {
  colormap: Colormap
  minValue: number
  maxValue: number
  label?: string
}

export default function ColorBar({ colormap, minValue, maxValue, label }: ColorBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Generate gradient on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Create gradient
    for (let x = 0; x < width; x++) {
      const t = x / (width - 1) // Normalize to 0-1
      const [r, g, b] = applyColormap(t, colormap)

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(x, 0, 1, height)
    }
  }, [colormap])

  // Format value for display
  const formatValue = (value: number): string => {
    if (Math.abs(value) >= 1000) {
      return value.toFixed(0)
    } else if (Math.abs(value) >= 100) {
      return value.toFixed(1)
    } else if (Math.abs(value) >= 10) {
      return value.toFixed(2)
    } else {
      return value.toFixed(3)
    }
  }

  return (
    <div className="colorbar-container">
      {label && <div className="colorbar-label">{label}</div>}
      <div className="colorbar-wrapper">
        <canvas
          ref={canvasRef}
          width={256}
          height={20}
          className="colorbar-canvas"
        />
        <div className="colorbar-ticks">
          <span className="colorbar-tick colorbar-tick-min">{formatValue(minValue)}</span>
          <span className="colorbar-tick colorbar-tick-max">{formatValue(maxValue)}</span>
        </div>
      </div>
    </div>
  )
}
