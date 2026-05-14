import { createViewers } from './viewer.js'
import { loadCopc } from './copc-loader.js'
import { getGroundTruthUrl, getPredictionUrl } from './config.js'

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  forest: 'benchapan',
  training: 'fine-tune-encoder',
  feature: 'xyz',
  model: 'pointnext-l',
  visibleClasses: new Set([1, 2, 3]),
  splitDir: 'vertical',
  pointSize: 2,
  viewMode: 'split',
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const viewerArea     = document.getElementById('viewer-area')
const paneLeft       = document.getElementById('pane-left')
const paneRight      = document.getElementById('pane-right')
const splitHandle    = document.getElementById('split-handle')
const canvasGt       = document.getElementById('canvas-gt')
const canvasPred     = document.getElementById('canvas-pred')
const overlayGt      = document.getElementById('overlay-gt')
const overlayPred    = document.getElementById('overlay-pred')
const statusGt       = document.getElementById('status-gt')
const statusPred     = document.getElementById('status-pred')
const predLabel      = document.getElementById('pred-label')
const overlayDivider = document.getElementById('overlay-divider')

// ─── Viewers ──────────────────────────────────────────────────────────────────

const { v1, v2 } = createViewers(canvasGt, canvasPred)

// ─── Loading helpers ──────────────────────────────────────────────────────────

function setStatus(el, s) {
  el.querySelector('.status-dot').className = `status-dot ${s}`
}

function showOverlay(el, msg) {
  el.querySelector('span').textContent = msg
  el.classList.remove('hidden')
}

function hideOverlay(el) { el.classList.add('hidden') }

let currentGtUrl   = null
let currentPredUrl = null

async function loadCloud(viewer, url, overlayEl, statusEl, label, fitCamera = true) {
  if (!url) return
  showOverlay(overlayEl, `Loading ${label}…`)
  setStatus(statusEl, 'loading')
  try {
    await loadCopc(url, {
      maxDepth: 2,
      onFirstRender: (cloud) => {
        cloud.setVisibleClasses(state.visibleClasses)
        cloud.setPointSize(state.pointSize)
        viewer.setCloud(cloud, fitCamera)
        setStatus(statusEl, 'ready')
        hideOverlay(overlayEl)
      },
      onProgress: (f) => {
        const pct = Math.round(f * 100)
        statusEl.querySelector('.status-label').textContent =
          pct < 100 ? `${label} ${pct}%` : label
      },
    })
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
}

function loadPrediction() {
  const url = getPredictionUrl(state.training, state.feature, state.model, state.forest)
  if (url === currentPredUrl) return
  currentPredUrl = url
  updatePredLabel()
  loadCloud(v2, url, overlayPred, statusPred, 'Prediction', false)
}

function updatePredLabel() {
  const modelName  = document.querySelector(`#model-select option[value="${state.model}"]`)?.textContent ?? state.model
  const featLabel  = state.feature === 'xyz' ? 'XYZ' : 'XYZ+HAG'
  const trainLabel = state.training === 'pretrained' ? 'Pretrained' : 'Fine-tuned'
  predLabel.textContent = `${modelName} · ${featLabel} · ${trainLabel}`
}

function loadBoth() { loadGroundTruth(); loadPrediction() }

// ─── Overlay mode (before/after curtain) ──────────────────────────────────────

let overlayFrac     = 0.5
let overlayDragging = false

function setOverlayClip(frac) {
  overlayFrac = Math.max(0.02, Math.min(0.98, frac))
  const pct    = (overlayFrac * 100).toFixed(2)
  const invPct = ((1 - overlayFrac) * 100).toFixed(2)
  // GT on left, clipped on right edge
  paneLeft.style.clipPath  = `inset(0 ${invPct}% 0 0)`
  // Pred on right, clipped on left edge
  paneRight.style.clipPath = `inset(0 0 0 ${pct}%)`
  overlayDivider.style.left = `${pct}%`
}

function applyViewMode(mode) {
  if (mode === 'split') {
    viewerArea.classList.remove('overlay-mode')
    paneLeft.style.clipPath        = ''
    paneRight.style.clipPath       = ''
    paneLeft.style.flex            = '1 1 0'
    paneRight.style.flex           = '1 1 0'
    splitHandle.style.display      = ''
    overlayDivider.style.display   = 'none'
    predLabel.style.left           = '12px'
    predLabel.style.right          = 'auto'
  } else {
    // overlay
    viewerArea.classList.add('overlay-mode')
    paneLeft.style.flex            = ''
    paneRight.style.flex           = ''
    splitHandle.style.display      = 'none'
    overlayDivider.style.display   = 'block'
    predLabel.style.left           = 'auto'
    predLabel.style.right          = '12px'
    setOverlayClip(overlayFrac)
  }
}

overlayDivider.addEventListener('mousedown', (e) => {
  overlayDragging = true
  e.preventDefault()
})

document.addEventListener('mousemove', (e) => {
  if (!overlayDragging) return
  const rect = viewerArea.getBoundingClientRect()
  setOverlayClip((e.clientX - rect.left) / rect.width)
})

document.addEventListener('mouseup', () => { overlayDragging = false })

overlayDivider.addEventListener('touchstart', (e) => {
  overlayDragging = true
  e.preventDefault()
}, { passive: false })

document.addEventListener('touchmove', (e) => {
  if (!overlayDragging) return
  const rect = viewerArea.getBoundingClientRect()
  setOverlayClip((e.touches[0].clientX - rect.left) / rect.width)
}, { passive: true })

document.addEventListener('touchend', () => { overlayDragging = false })

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

// ─── Controls ─────────────────────────────────────────────────────────────────

initBtnGroup('forest-btns', 'forest', () => {
  currentGtUrl = null; currentPredUrl = null
  loadBoth()
})

initBtnGroup('training-btns', 'training', () => { currentPredUrl = null; loadPrediction() })
initBtnGroup('feature-btns',  'feature',  () => { currentPredUrl = null; loadPrediction() })

document.getElementById('model-select').addEventListener('change', (e) => {
  state.model = e.target.value
  currentPredUrl = null
  loadPrediction()
})

initBtnGroup('mode-btns', 'viewMode', (mode) => applyViewMode(mode))

document.querySelectorAll('.cls-check').forEach(cb => {
  cb.addEventListener('change', () => {
    const code = Number(cb.dataset.code)
    if (cb.checked) state.visibleClasses.add(code)
    else state.visibleClasses.delete(code)
    v1.setVisibleClasses(state.visibleClasses)
    v2.setVisibleClasses(state.visibleClasses)
  })
})

const ptSizeInput = document.getElementById('pt-size')
const ptSizeVal   = document.getElementById('pt-size-val')
ptSizeInput.addEventListener('input', () => {
  state.pointSize = Number(ptSizeInput.value)
  ptSizeVal.textContent = state.pointSize
  v1.setPointSize(state.pointSize)
  v2.setPointSize(state.pointSize)
})

initBtnGroup('split-btns', 'splitDir', (dir) => {
  viewerArea.classList.toggle('split-vertical',   dir === 'vertical')
  viewerArea.classList.toggle('split-horizontal', dir === 'horizontal')
  if (state.viewMode === 'split') {
    splitHandle.style.cursor = dir === 'vertical' ? 'col-resize' : 'row-resize'
    paneLeft.style.flex  = '1 1 0'
    paneRight.style.flex = '1 1 0'
  }
})

// ─── Resizable split handle ───────────────────────────────────────────────────

let splitDragging = false, startPos = 0, startLeft = 0, startRight = 0

splitHandle.addEventListener('mousedown', (e) => {
  splitDragging = true
  splitHandle.classList.add('dragging')
  const isV = state.splitDir === 'vertical'
  startPos   = isV ? e.clientX : e.clientY
  startLeft  = isV ? paneLeft.offsetWidth  : paneLeft.offsetHeight
  startRight = isV ? paneRight.offsetWidth : paneRight.offsetHeight
  e.preventDefault()
})

document.addEventListener('mousemove', (e) => {
  if (!splitDragging) return
  const isV  = state.splitDir === 'vertical'
  const delta = (isV ? e.clientX : e.clientY) - startPos
  paneLeft.style.flex  = `0 0 ${Math.max(100, startLeft  + delta)}px`
  paneRight.style.flex = `0 0 ${Math.max(100, startRight - delta)}px`
})

document.addEventListener('mouseup', () => {
  if (splitDragging) { splitDragging = false; splitHandle.classList.remove('dragging') }
})

splitHandle.addEventListener('touchstart', (e) => {
  const t = e.touches[0], isV = state.splitDir === 'vertical'
  splitDragging = true
  startPos   = isV ? t.clientX : t.clientY
  startLeft  = isV ? paneLeft.offsetWidth  : paneLeft.offsetHeight
  startRight = isV ? paneRight.offsetWidth : paneRight.offsetHeight
  e.preventDefault()
}, { passive: false })

document.addEventListener('touchmove', (e) => {
  if (!splitDragging) return
  const t = e.touches[0], isV = state.splitDir === 'vertical'
  const delta = (isV ? t.clientX : t.clientY) - startPos
  paneLeft.style.flex  = `0 0 ${Math.max(100, startLeft  + delta)}px`
  paneRight.style.flex = `0 0 ${Math.max(100, startRight - delta)}px`
}, { passive: true })

document.addEventListener('touchend', () => { splitDragging = false })

// ─── EDL controls ─────────────────────────────────────────────────────────────

const edlToggle   = document.getElementById('edl-toggle')
const edlStrInput = document.getElementById('edl-strength')
const edlRadInput = document.getElementById('edl-radius')
const edlStrVal   = document.getElementById('edl-str-val')
const edlRadVal   = document.getElementById('edl-rad-val')

function applyEdl() {
  const on = edlToggle.checked, str = Number(edlStrInput.value), rad = Number(edlRadInput.value)
  for (const v of [v1, v2]) { v.setEdlEnabled(on); v.setEdlStrength(str); v.setEdlRadius(rad) }
}

edlToggle.addEventListener('change', applyEdl)
edlStrInput.addEventListener('input', () => { edlStrVal.textContent = edlStrInput.value; applyEdl() })
edlRadInput.addEventListener('input', () => { edlRadVal.textContent = edlRadInput.value; applyEdl() })
applyEdl()

// ─── Reset view ───────────────────────────────────────────────────────────────

document.getElementById('reset-view').addEventListener('click', () => { v1.resetView(); v2.resetView() })

// ─── Double-click pivot ───────────────────────────────────────────────────────

canvasGt.addEventListener('dblclick',   (e) => v1.focusAtScreenPoint(e.clientX, e.clientY))
canvasPred.addEventListener('dblclick', (e) => v2.focusAtScreenPoint(e.clientX, e.clientY))

// ─── Help dialog ──────────────────────────────────────────────────────────────

const helpModal = document.getElementById('help-modal')
const helpClose = document.getElementById('help-close')
const helpBtn   = document.getElementById('help-btn')

function closeHelp() { helpModal.classList.add('hidden'); localStorage.setItem('helpSeen', '1') }

helpClose.addEventListener('click', closeHelp)
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp() })
helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'))

if (localStorage.getItem('helpSeen')) helpModal.classList.add('hidden')

// ─── Initial load ─────────────────────────────────────────────────────────────

loadBoth()
