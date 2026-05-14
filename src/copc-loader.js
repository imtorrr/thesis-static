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
  /**
   * @param {THREE.Group} group
   * @param {Record<number, THREE.Points>} classPoints
   * @param {Float32Array} rawPositions  flat xyz, centered, length = n*3
   * @param {Uint8Array}   rawClasses    classification per point, length = n
   */
  constructor(group, classPoints, rawPositions, rawClasses) {
    this.group = group
    this._pts = classPoints
    this.rawPositions = rawPositions
    this.rawClasses   = rawClasses
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

// ─── Octree helpers ───────────────────────────────────────────────────────────

function nodeBox(key, header, cx, cy, cz) {
  const [d, nx, ny, nz] = key.split('-').map(Number)
  const divs = Math.pow(2, d)
  const sx = (header.max[0] - header.min[0]) / divs
  const sy = (header.max[1] - header.min[1]) / divs
  const sz = (header.max[2] - header.min[2]) / divs
  return new THREE.Box3(
    new THREE.Vector3(header.min[0] + sx * nx - cx,       header.min[1] + sy * ny - cy,       header.min[2] + sz * nz - cz),
    new THREE.Vector3(header.min[0] + sx * (nx+1) - cx,   header.min[1] + sy * (ny+1) - cy,   header.min[2] + sz * (nz+1) - cz)
  )
}

function angularSize(box, camera) {
  const sphere = new THREE.Sphere()
  box.getBoundingSphere(sphere)
  const dist = Math.max(0.001, camera.position.distanceTo(sphere.center) - sphere.radius)
  return 2 * Math.atan(sphere.radius / dist)  // radians
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map() // cacheKey → Promise<LoadedCloud>

export function clearCopcCache() { _cache.clear() }

// ─── Main API ─────────────────────────────────────────────────────────────────
export async function loadCopc(url, opts = {}) {
  const { maxDepth = 8, camera, minAngle = 0.005, onFirstRender, onProgress } = opts
  const absUrl = toAbsUrl(url)

  // Cache key includes view params so different camera angles get fresh loads
  const cacheKey = absUrl
  if (_cache.has(cacheKey)) {
    const cloud = await _cache.get(cacheKey)
    onFirstRender?.(cloud)
    onProgress?.(1, cloud)
    return cloud
  }

  const promise = _loadFresh(absUrl, maxDepth, camera, minAngle, onFirstRender, onProgress)
  _cache.set(cacheKey, promise)
  return promise
}

async function _loadFresh(absUrl, maxDepth, camera, minAngle, onFirstRender, onProgress) {

  const [copc, lazPerf] = await Promise.all([Copc.create(absUrl), getLazPerf()])
  const { header, info } = copc

  const cx = (header.min[0] + header.max[0]) / 2
  const cy = (header.min[1] + header.max[1]) / 2
  const cz = (header.min[2] + header.max[2]) / 2

  const { nodes } = await Copc.loadHierarchyPage(absUrl, info.rootHierarchyPage)

  // Estimate ideal view distance from cloud bounds (independent of current camera state)
  // Mirrors fitToCloud logic: place camera far enough to see the whole cloud
  const size = [header.max[0]-header.min[0], header.max[1]-header.min[1], header.max[2]-header.min[2]]
  const fovRad = ((camera?.fov ?? 55) * Math.PI) / 180
  const aspect = camera?.aspect ?? 1
  const hFov   = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
  const refDist = Math.max(
    (size[2] / 2) / Math.tan(fovRad / 2),
    (size[0] / 2) / Math.tan(hFov  / 2)
  ) * 1.5

  // Build frustum from camera for behind-camera culling only
  let frustum = null
  if (camera) {
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    frustum = new THREE.Frustum()
    frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    )
  }

  const allEntries = Object.entries(nodes)
    .filter(([key, node]) => node && node.pointCount > 0 && parseInt(key, 10) <= maxDepth)
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))  // coarse first

  // LOD filter using reference distance — always keep depth-0 root
  const refCamera = { position: new THREE.Vector3(0, -refDist, 0) }
  const entries = allEntries.filter(([key]) => {
    const depth = parseInt(key.split('-')[0])
    if (depth === 0) return true
    const box = nodeBox(key, header, cx, cy, cz)
    if (frustum && !frustum.intersectsBox(box)) return false
    return angularSize(box, refCamera) >= minAngle
  })

  console.log(`[copc] ${entries.length}/${allEntries.length} nodes after frustum+LOD cull`)

  // Pre-allocate per-class buffers — size to filtered set to avoid huge unused allocations
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

  // Raw flat buffers for diff comparison (same centred coords as class buffers)
  const rawPositions = new Float32Array(totalPts * 3)
  const rawClasses   = new Uint8Array(totalPts)
  let rawCount = 0

  const cloud = new LoadedCloud(group, classPoints, rawPositions, rawClasses)
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
        const x = getX(j) - cx
        const y = getY(j) - cy
        const z = getZ(j) - cz
        const k = b.count
        b.posArr[k * 3]     = x
        b.posArr[k * 3 + 1] = y
        b.posArr[k * 3 + 2] = z
        b.count++
        rawPositions[rawCount * 3]     = x
        rawPositions[rawCount * 3 + 1] = y
        rawPositions[rawCount * 3 + 2] = z
        rawClasses[rawCount] = cls
        rawCount++
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
    // Expose current raw count so diff can be built incrementally if needed
    cloud.rawCount = rawCount

    // Notify caller so they can show the viewer as soon as depth-0 renders
    if (!firstRenderDone) {
      firstRenderDone = true
      onFirstRender?.(cloud)
    }

    onProgress?.((i + 1) / entries.length, cloud)
  }

  // Trim raw buffers to actual point count
  cloud.rawPositions = rawPositions.subarray(0, rawCount * 3)
  cloud.rawClasses   = rawClasses.subarray(0, rawCount)
  cloud.rawCount     = rawCount
  return cloud
}
