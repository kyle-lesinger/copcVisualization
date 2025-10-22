import { FileMode } from '../App'
import './FileSelector.css'

interface FileSelectorProps {
  fileMode: FileMode
  onFileModeChange: (mode: FileMode) => void
  singleFiles: string[]
  tiledFiles: string[]
  selectedFiles: string[]
  onSelectionChange: (files: string[]) => void
}

export default function FileSelector({
  fileMode,
  onFileModeChange,
  singleFiles,
  tiledFiles,
  selectedFiles,
  onSelectionChange
}: FileSelectorProps) {
  const availableFiles = fileMode === 'single' ? singleFiles : tiledFiles

  const handleFileToggle = (file: string) => {
    if (selectedFiles.includes(file)) {
      onSelectionChange(selectedFiles.filter(f => f !== file))
    } else {
      onSelectionChange([...selectedFiles, file])
    }
  }

  const getFileName = (path: string) => {
    return path.split('/').pop() || path
  }

  return (
    <div className="panel file-selector">
      <h3>COPC Files</h3>

      <div className="file-mode-selector">
        <label>
          <input
            type="radio"
            value="single"
            checked={fileMode === 'single'}
            onChange={() => onFileModeChange('single')}
          />
          Single File
        </label>
        <label>
          <input
            type="radio"
            value="tiled"
            checked={fileMode === 'tiled'}
            onChange={() => onFileModeChange('tiled')}
          />
          Tiled (4 files)
        </label>
      </div>

      <div className="file-list">
        {availableFiles.map(file => (
          <label key={file} className="file-item">
            <input
              type="checkbox"
              checked={selectedFiles.includes(file)}
              onChange={() => handleFileToggle(file)}
            />
            <span className="file-name" title={file}>
              {getFileName(file)}
            </span>
          </label>
        ))}
      </div>

      <div className="file-info">
        <small>
          {fileMode === 'single'
            ? '193 MB • 35M points'
            : '4 tiles • 191 MB total • 35M points'
          }
        </small>
      </div>
    </div>
  )
}
