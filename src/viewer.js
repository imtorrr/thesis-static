/**
 * Dual Three.js point cloud viewer with synchronized cameras and EDL.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EdlPass } from './edl.js'

const BG_COLOR = new THREE.Color(0x0f1117)

class Viewer {
  constructor(canvas) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(BG_COLOR)

    this.scene = new THREE.Scene()
    this.scene.background = BG_COLOR

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100000)
    this.camera.up.set(0, 0, 1)   // LiDAR data: Z = vertical height
    this.camera.position.set(0, -80, 10)
    this.camera.lookAt(0, 0, 0)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = 0.5
    this.controls.zoomSpeed = 1.2
    this.controls.panSpeed = 0.8
    this.controls.screenSpacePanning = true

    this.edl = new EdlPass(this.renderer)

    this._cloud = null
    this._lastW  = 0
    this._lastH  = 0

    this._indicatorTimer = null
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement
    if (w === this._lastW && h === this._lastH) return
    this._lastW = w; this._lastH = h
    this.renderer.setSize(w, h, false)
    this.edl.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setCloud(cloud, fitCamera = true) {
    if (this._cloud) {
      this.scene.remove(this._cloud.group)
    }
    this._cloud = cloud
    if (cloud) {
      this.scene.add(cloud.group)
      if (fitCamera) this.fitToCloud(cloud)
    }
  }

  fitToCloud(cloud) {
    const box = new THREE.Box3().setFromObject(cloud.group)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size   = box.getSize(new THREE.Vector3())

    // LiDAR: X=east, Y=north, Z=height(up).
    // Front view: camera along -Y, looking +Y. Screen: X=right, Z=up.
    // Trees appear upright: ground bottom, canopy top.
    const fov    = this.camera.fov * (Math.PI / 180)
    const aspect = this.camera.aspect || 1
    const hFov   = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    const distV  = (size.z / 2) / Math.tan(fov / 2)   // fit height (Z)
    const distH  = (size.x / 2) / Math.tan(hFov / 2)  // fit width (X)
    const dist   = Math.max(distV, distH) * 1.5

    this.controls.target.copy(center)
    this.camera.position.set(center.x, center.y - dist, center.z)
    this.camera.near = dist * 0.001
    this.camera.far  = dist * 10
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  setVisibleClasses(visSet) { this._cloud?.setVisibleClasses(visSet) }
  setPointSize(px)          { this._cloud?.setPointSize(px) }

  setEdlEnabled(on)   { this.edl.enabled  = on }
  setEdlStrength(v)   { this.edl.strength = v  }
  setEdlRadius(v)     { this.edl.radius   = v  }

  focusAtScreenPoint(clientX, clientY) {
    if (!this._cloud) return
    const rect = this.canvas.getBoundingClientRect()
    const x =  ((clientX - rect.left)  / rect.width)  * 2 - 1
    const y = -((clientY - rect.top)   / rect.height) * 2 + 1

    const ray = new THREE.Raycaster()
    // Scale threshold with camera distance — works correctly at any zoom level
    const camDist = this.camera.position.distanceTo(this.controls.target)
    ray.params.Points.threshold = Math.max(0.05, camDist * 0.005)
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera)

    const visiblePts = this._cloud.group.children.filter(o => o.visible)
    const hits = ray.intersectObjects(visiblePts, false)

    let newTarget
    if (hits.length > 0) {
      newTarget = hits[0].point
    } else {
      // Fallback: plane perpendicular to view at current target depth
      const normal = new THREE.Vector3()
      this.camera.getWorldDirection(normal)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.controls.target)
      newTarget = new THREE.Vector3()
      if (!ray.ray.intersectPlane(plane, newTarget)) return
    }

    this.controls.target.copy(newTarget)
    this.controls.update()
    return newTarget
  }

  resetView() {
    if (this._cloud) this.fitToCloud(this._cloud)
  }

  getCameraState() {
    return { pos: this.camera.position.clone(), target: this.controls.target.clone(), zoom: this.camera.zoom }
  }

  setCameraState({ pos, target, zoom }) {
    this.camera.position.copy(pos)
    this.controls.target.copy(target)
    this.camera.zoom = zoom
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  render() {
    this.controls.update()
    this.edl.render(this.scene, this.camera)
  }

  dispose() {
    if (this._indicatorTimer) clearTimeout(this._indicatorTimer)
    this._cloud?.dispose()
    this.edl.dispose()
    this.renderer.dispose()
    this.controls.dispose()
  }
}

export function createViewers(canvasGt, canvasPred) {
  const v1 = new Viewer(canvasGt)
  const v2 = new Viewer(canvasPred)

  let syncing = false
  function sync(src, dst) {
    if (syncing) return
    syncing = true
    dst.setCameraState(src.getCameraState())
    syncing = false
  }
  v1.controls.addEventListener('change', () => sync(v1, v2))
  v2.controls.addEventListener('change', () => sync(v2, v1))

  let animId = null
  function loop() {
    animId = requestAnimationFrame(loop)
    v1.resize(); v2.resize()
    v1.render(); v2.render()
  }
  loop()

  return { v1, v2, stop: () => cancelAnimationFrame(animId) }
}
