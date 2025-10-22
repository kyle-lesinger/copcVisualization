import { useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js'
import { Scatter } from 'react-chartjs-2'
import './AOIScatterPlot.css'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

interface AOIScatterPlotProps {
  altitudes: number[]
  intensities: number[]
  pointCount: number
  onClose: () => void
}

export default function AOIScatterPlot({ altitudes, intensities, pointCount, onClose }: AOIScatterPlotProps) {
  const chartRef = useRef(null)

  // Prepare data for Chart.js
  // X-axis: intensity, Y-axis: altitude
  const chartData = {
    datasets: [
      {
        label: 'Intensity vs Altitude',
        data: altitudes.map((alt, idx) => ({
          x: intensities[idx],
          y: alt
        })),
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        pointRadius: 2,
        pointHoverRadius: 4
      }
    ]
  }

  const options: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Intensity (Backscatter 532nm)',
          font: {
            size: 14
          }
        }
      },
      y: {
        type: 'linear',
        title: {
          display: true,
          text: 'Altitude (km)',
          font: {
            size: 14
          }
        },
        min: -0.5,
        max: 40
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      title: {
        display: true,
        text: `AOI Data Distribution (${pointCount.toLocaleString()} points)`,
        font: {
          size: 16,
          weight: 'bold'
        }
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const alt = context.parsed.y.toFixed(2)
            const intensity = context.parsed.x.toFixed(0)
            return `Alt: ${alt} km, Intensity: ${intensity}`
          }
        }
      }
    }
  }

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="aoi-scatter-overlay" onClick={onClose}>
      <div className="aoi-scatter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="aoi-scatter-header">
          <div className="aoi-scatter-info">
            <div>Area of Interest Analysis</div>
            <div>{pointCount.toLocaleString()} data points selected</div>
          </div>
          <button className="aoi-scatter-close" onClick={onClose}>×</button>
        </div>
        <div className="aoi-scatter-content">
          <Scatter ref={chartRef} data={chartData} options={options} />
        </div>
      </div>
    </div>
  )
}
