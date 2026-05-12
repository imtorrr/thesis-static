// Maps {training, feature, model, forest} to COPC file URL
// All paths relative to the site root

// Vite serves public/ at root; set VITE_DATA_BASE env var to override for CDN/remote hosting
export const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? '/data'

export const FORESTS = [
  { value: 'benchapan', label: 'Benchapan' },
  { value: 'diplang',   label: 'Diplang'   },
  { value: 'tengrung',  label: 'Tengrung'  },
]

export const MODELS = [
  { value: 'pointnet++',  label: 'PointNet++ (Vanilla)'   },
  { value: 'fsct',        label: 'PointNet++ (Modified)'  },
  { value: 'pointnext-s', label: 'PointNeXt-S'            },
  { value: 'pointnext-l', label: 'PointNeXt-L'            },
]

// Classification code → { label, color (hex) }
export const CLASSES = {
  1: { label: 'Ground',     color: '#C19A6B' },
  2: { label: 'Stem',       color: '#E74C3C' },
  3: { label: 'Vegetation', color: '#27AE60' },
}

export function getGroundTruthUrl(forest) {
  return `${DATA_BASE}/ground_truth/${forest}.copc.laz`
}

export function getPredictionUrl(training, feature, model, forest) {
  return `${DATA_BASE}/${training}/${feature}/${model}/${forest}.copc.laz`
}
