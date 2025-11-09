import './ControlsInfo.css'

export default function ControlsInfo() {
  return (
    <div className="controls-info-panel">
      <h4>Controls:</h4>
      <ul>
        <li><kbd>Left Mouse</kbd> - Rotate</li>
        <li><kbd>Right Mouse</kbd> - Pan</li>
        <li><kbd>Scroll</kbd> - Zoom</li>
        <li><kbd>R</kbd> - Reset Camera</li>
      </ul>
    </div>
  )
}
