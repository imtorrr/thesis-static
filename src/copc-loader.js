/**
 * Progressive COPC loader → Three.js scene objects.
 *
 * Renders depth-0 node immediately, then streams deeper levels.
 * Uses pre-allocated DynamicDrawUsage buffers + setDrawRange for
 * zero-reallocation progressive updates.
 *
 * Classification codes: 1=Ground, 2=Stem, 3=Vegetation
 */

import * as THREE from 'three'
import { Copc } from 'copc'
import { createLazPerf } from 'laz-perf'
import lazPerfWasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url'
import { CLASSES } from './config.js'

// ─── Singleton laz-perf (correct WASM path) ───────────────────────────────────
let _lazPerf = null
async function getLazPerf() {
  if (!_lazPerf) _lazPerf = await createLazPerf({ locateFile: () => lazPerfWasmUrl })
  return _lazPerf
}

// ─── Color map ────────────────────────────────────────────────────────────────
const CLASS_COLOR = Object.fromEntries(
  Object.entries(CLASSES).map(([code, { color }]) => [code, new THREE.Color(color)])
)

// ─── URL helper ───────────────────────────────────────────────────────────────
function toAbsUrl(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return new URL(url, window.location.href).href
}

// ─── LoadedCloud ──────────────────────────────────────────────────────────────
export class LoadedCloud {
  /** @param {THREE.Group} group @param {Record<number, THREE.Points>} classPoints */
  constructor(group, classPoints) {
    this.group = group
    this._pts = classPoints
  }

  setVisibleClasses(visSet) {
    for (const [cls, pts] of Object.entries(this._pts)) {
      pts.visible = visSet.has(Number(cls))
    }
  }

  setPointSize(px) {
    for (const pts of Object.values(this._pts)) {
      pts.material.size = px
      pts.material.needsUpdate = true
    }
  }

  dispose() {
    for (const pts of Object.values(this._pts)) {
      pts.geometry.dispose()
      pts.material.dispose()
    }
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map() // absUrl → Promise<LoadedCloud>

export function clearCopcCache() { _cache.clear() }

// ─── Main API ─────────────────────────────────────────────────────────────────
export async function loadCopc(url, opts = {}) {
  const { maxDepth = 8, onFirstRender, onProgress } = opts
  const absUrl = toAbsUrl(url)

  if (_cache.has(absUrl)) {
    const cloud = await _cache.get(absUrl)
    onFirstRender?.(cloud)
    onProgress?.(1, cloud)
    return cloud
  }

  const promise = _loadFresh(absUrl, maxDepth, onFirstRender, onProgress)
  _cache.set(absUrl, promise)
  return promise
}

async function _loadFresh(absUrl, maxDepth, onFirstRender, onProgress) {

  const [copc, lazPerf] = await Promise.all([Copc.create(absUrl), getLazPerf()])
  const { header, info } = copc

  const cx = (header.min[0] + header.max[0]) / 2
  const cy = (header.min[1] + header.max[1]) / 2
  const cz = (header.min[2] + header.max[2]) / 2

  const { nodes } = await Copc.loadHierarchyPage(absUrl, info.rootHierarchyPage)

  const entries = Object.entries(nodes)
    .filter(([key, node]) => node && node.pointCount > 0 && parseInt(key, 10) <= maxDepth)
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))  // coarse first

  // Pre-allocate per-class buffers sized to total point count
  const totalPts = entries.reduce((s, [, n]) => s + n.pointCount, 0)

  const bufs = {}
  const classPoints = {}
  const group = new THREE.Group()

  for (const cls of [1, 2, 3]) {
    const posArr = new Float32Array(totalPts * 3)
    const posAttr = new THREE.BufferAttribute(posArr, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', posAttr)
    geo.setDrawRange(0, 0)

    const mat = new THREE.PointsMaterial({
      color: CLASS_COLOR[cls],
      size: 2,
      sizeAttenuation: false,
    })

    const pts = new THREE.Points(geo, mat)
    group.add(pts)

    bufs[cls] = { posArr, posAttr, geo, count: 0 }
    classPoints[cls] = pts
  }

  const cloud = new LoadedCloud(group, classPoints)
  let firstRenderDone = false

  for (let i = 0; i < entries.length; i++) {
    const [key, node] = entries[i]
    try {
      const view = await Copc.loadPointDataView(absUrl, copc, node, { lazPerf })
      const getX   = view.getter('X')
      const getY   = view.getter('Y')
      const getZ   = view.getter('Z')
      const getCls = view.getter('Classification')

      for (let j = 0; j < view.pointCount; j++) {
        const cls = getCls(j)
        const b = bufs[cls]
        if (!b) continue
        const k = b.count
        b.posArr[k * 3]     = getX(j) - cx
        b.posArr[k * 3 + 1] = getY(j) - cy
        b.posArr[k * 3 + 2] = getZ(j) - cz
        b.count++
      }
    } catch (err) {
      console.warn(`[copc] skipped node ${key}:`, err.message)
    }

    // Flush draw ranges after every node
    for (const cls of [1, 2, 3]) {
      const b = bufs[cls]
      b.geo.setDrawRange(0, b.count)
      b.posAttr.needsUpdate = true
    }

    // Notify caller so they can show the viewer as soon as depth-0 renders
    if (!firstRenderDone) {
      firstRenderDone = true
      onFirstRender?.(cloud)
    }

    onProgress?.((i + 1) / entries.length, cloud)
  }

  return cloud
}
