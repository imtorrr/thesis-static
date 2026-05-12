import { createViewers } from './viewer.js'
import { loadCopc } from './copc-loader.js'
import { getGroundTruthUrl, getPredictionUrl, CLASSES } from './config.js'

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  forest: 'benchapan',
  training: 'fine-tune-encoder',
  feature: 'xyz',
  model: 'pointnext-l',
  visibleClasses: new Set([1, 2, 3]),
  splitDir: 'vertical',
  pointSize: 2,
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const viewerArea  = document.getElementById('viewer-area')
const paneLeft    = document.getElementById('pane-left')
const paneRight   = document.getElementById('pane-right')
const splitHandle = document.getElementById('split-handle')
const canvasGt    = document.getElementById('canvas-gt')
const canvasPred  = document.getElementById('canvas-pred')
const overlayGt   = document.getElementById('overlay-gt')
const overlayPred = document.getElementById('overlay-pred')
const statusGt    = document.getElementById('status-gt')
const statusPred  = document.getElementById('status-pred')
const predLabel   = document.getElementById('pred-label')

// ─── Viewers ──────────────────────────────────────────────────────────────────

const { v1, v2 } = createViewers(canvasGt, canvasPred)

// ─── Loading helpers ──────────────────────────────────────────────────────────

function setStatus(el, state) {
  const dot = el.querySelector('.status-dot')
  dot.className = `status-dot ${state}`
}

function showOverlay(overlayEl, msg) {
  overlayEl.querySelector('span').textContent = msg
  overlayEl.classList.remove('hidden')
}

function hideOverlay(overlayEl) {
  overlayEl.classList.add('hidden')
}

let loadingGt = false
let loadingPred = false
let currentGtUrl = null
let currentPredUrl = null

async function loadCloud(viewer, url, overlayEl, statusEl, label, fitCamera = true) {
  if (!url) return

  showOverlay(overlayEl, `Loading ${label}…`)
  setStatus(statusEl, 'loading')

  try {
    await loadCopc(url, {
      maxDepth: 8,

      onFirstRender: (cloud) => {
        // Show the viewer as soon as depth-0 is ready — before full load
        cloud.setVisibleClasses(state.visibleClasses)
        cloud.setPointSize(state.pointSize)
        viewer.setCloud(cloud, fitCamera)
        setStatus(statusEl, 'ready')
        hideOverlay(overlayEl)
      },

      onProgress: (f) => {
        // Update status label with streaming progress (overlay already hidden)
        const pct = Math.round(f * 100)
        statusEl.querySelector('.status-label').textContent =
          pct < 100 ? `${label} ${pct}%` : label
      },
    })

    // Restore clean label when fully done
    statusEl.querySelector('.status-label').textContent = label

  } catch (err) {
    console.error('[load]', url, err)
    setStatus(statusEl, 'error')
    overlayEl.querySelector('span').textContent = `Error: ${err.message}`
  }
}

function loadGroundTruth() {
  const url = getGroundTruthUrl(state.forest)
  if (url === currentGtUrl) return
  currentGtUrl = url
  loadCloud(v1, url, overlayGt, statusGt, 'Ground Truth', true)
  // onFirstRender triggers fitCamera on v1; OrbitControls sync propagates to v2 automatically
}

function loadPrediction() {
  const url = getPredictionUrl(state.training, state.feature, state.model, state.forest)
  if (url === currentPredUrl) return
  currentPredUrl = url
  updatePredLabel()
  // Don't fit camera for pred — GT drives position; sync copies it after GT loads
  loadCloud(v2, url, overlayPred, statusPred, 'Prediction', false)
}

function updatePredLabel() {
  const modelName = document.querySelector('#model-select option[value="' + state.model + '"]')?.textContent ?? state.model
  const featureLabel = state.feature === 'xyz' ? 'XYZ' : 'XYZ+HAG'
  const trainingLabel = state.training === 'pretrained' ? 'Pretrained' : 'Fine-tuned'
  predLabel.textContent = `${modelName} · ${featureLabel} · ${trainingLabel}`
}

function loadBoth() {
  loadGroundTruth()
  loadPrediction()
}

// ─── Button group helper ──────────────────────────────────────────────────────

function initBtnGroup(containerId, stateKey, onChange) {
  const container = document.getElementById(containerId)
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle')
    if (!btn) return
    const val = btn.dataset.value
    if (state[stateKey] === val) return

    container.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state[stateKey] = val
    onChange(val)
  })
}

// ─── Controls init ────────────────────────────────────────────────────────────

initBtnGroup('forest-btns', 'forest', () => {
  currentGtUrl = null
  currentPredUrl = null
  loadBoth()
})

initBtnGroup('training-btns', 'training', () => {
  currentPredUrl = null
  loadPrediction()
})

initBtnGroup('feature-btns', 'feature', () => {
  currentPredUrl = null
  loadPrediction()
})

document.getElementById('model-select').addEventListener('change', (e) => {
  state.model = e.target.value
  currentPredUrl = null
  loadPrediction()
})

// Classification filter
document.querySelectorAll('.cls-check').forEach(cb => {
  cb.addEventListener('change', () => {
    const code = Number(cb.dataset.code)
    if (cb.checked) state.visibleClasses.add(code)
    else state.visibleClasses.delete(code)

    v1.setVisibleClasses(state.visibleClasses)
    v2.setVisibleClasses(state.visibleClasses)
  })
})

// Point size
const ptSizeInput = document.getElementById('pt-size')
const ptSizeVal   = document.getElementById('pt-size-val')
ptSizeInput.addEventListener('input', () => {
  state.pointSize = Number(ptSizeInput.value)
  ptSizeVal.textContent = state.pointSize
  v1.setPointSize(state.pointSize)
  v2.setPointSize(state.pointSize)
})

// Split direction
initBtnGroup('split-btns', 'splitDir', (dir) => {
  viewerArea.className = dir === 'vertical' ? 'split-vertical' : 'split-horizontal'
  splitHandle.style.cursor = dir === 'vertical' ? 'col-resize' : 'row-resize'
  // Reset to 50/50
  paneLeft.style.flex  = '1 1 0'
  paneRight.style.flex = '1 1 0'
})

// ─── Resizable split handle ───────────────────────────────────────────────────

let dragging = false
let startPos = 0
let startLeft = 0
let startRight = 0

splitHandle.addEventListener('mousedown', (e) => {
  dragging = true
  splitHandle.classList.add('dragging')
  const isV = state.splitDir === 'vertical'
  startPos   = isV ? e.clientX : e.clientY
  startLeft  = isV ? paneLeft.offsetWidth  : paneLeft.offsetHeight
  startRight = isV ? paneRight.offsetWidth : paneRight.offsetHeight
  e.preventDefault()
})

document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const isV = state.splitDir === 'vertical'
  const cur = isV ? e.clientX : e.clientY
  const delta = cur - startPos
  const newLeft  = Math.max(100, startLeft + delta)
  const newRight = Math.max(100, startRight - delta)
  paneLeft.style.flex  = `0 0 ${newLeft}px`
  paneRight.style.flex = `0 0 ${newRight}px`
})

document.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false
    splitHandle.classList.remove('dragging')
  }
})

// Touch support for split handle
splitHandle.addEventListener('touchstart', (e) => {
  const t = e.touches[0]
  const isV = state.splitDir === 'vertical'
  dragging  = true
  startPos  = isV ? t.clientX : t.clientY
  startLeft  = isV ? paneLeft.offsetWidth  : paneLeft.offsetHeight
  startRight = isV ? paneRight.offsetWidth : paneRight.offsetHeight
  e.preventDefault()
}, { passive: false })

document.addEventListener('touchmove', (e) => {
  if (!dragging) return
  const t = e.touches[0]
  const isV = state.splitDir === 'vertical'
  const cur = isV ? t.clientX : t.clientY
  const delta = cur - startPos
  paneLeft.style.flex  = `0 0 ${Math.max(100, startLeft + delta)}px`
  paneRight.style.flex = `0 0 ${Math.max(100, startRight - delta)}px`
}, { passive: true })

document.addEventListener('touchend', () => { dragging = false })

// ─── EDL controls ────────────────────────────────────────────────────────────

const edlToggle   = document.getElementById('edl-toggle')
const edlStrInput = document.getElementById('edl-strength')
const edlRadInput = document.getElementById('edl-radius')
const edlStrVal   = document.getElementById('edl-str-val')
const edlRadVal   = document.getElementById('edl-rad-val')

function applyEdl() {
  const on  = edlToggle.checked
  const str = Number(edlStrInput.value)
  const rad = Number(edlRadInput.value)
  for (const v of [v1, v2]) {
    v.setEdlEnabled(on)
    v.setEdlStrength(str)
    v.setEdlRadius(rad)
  }
}

edlToggle.addEventListener('change', applyEdl)

edlStrInput.addEventListener('input', () => {
  edlStrVal.textContent = edlStrInput.value
  applyEdl()
})

edlRadInput.addEventListener('input', () => {
  edlRadVal.textContent = edlRadInput.value
  applyEdl()
})

applyEdl()

// ─── Reset view ───────────────────────────────────────────────────────────────

document.getElementById('reset-view').addEventListener('click', () => {
  v1.resetView()
  v2.resetView()
})

// ─── Double-click to set orbit center ────────────────────────────────────────

canvasGt.addEventListener('dblclick',   (e) => v1.focusAtScreenPoint(e.clientX, e.clientY))
canvasPred.addEventListener('dblclick', (e) => v2.focusAtScreenPoint(e.clientX, e.clientY))

// ─── Help dialog ──────────────────────────────────────────────────────────────

const helpModal = document.getElementById('help-modal')
const helpClose = document.getElementById('help-close')
const helpBtn   = document.getElementById('help-btn')

function closeHelp() {
  helpModal.classList.add('hidden')
  localStorage.setItem('helpSeen', '1')
}

helpClose.addEventListener('click', closeHelp)
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp() })
helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'))

if (localStorage.getItem('helpSeen')) {
  helpModal.classList.add('hidden')
}

// ─── Initial load ─────────────────────────────────────────────────────────────

loadBoth()
