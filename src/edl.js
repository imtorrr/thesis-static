/**
 * Eye-Dome Lighting (EDL) post-processing for Three.js.
 *
 * Two-pass approach:
 *   Pass 1: Render scene → WebGLRenderTarget (color + depth texture)
 *   Pass 2: Full-screen quad with EDL shader reads depth, darkens edges
 *
 * EDL makes point cloud depth structure immediately legible — it's
 * the signature look from Potree/CloudCompare.
 */

import * as THREE from 'three'

// ─── Shaders ──────────────────────────────────────────────────────────────────

const EDL_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`

const EDL_FRAG = /* glsl */`
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2      uResolution;
uniform float     uStrength;
uniform float     uRadius;
uniform float     uNear;
uniform float     uFar;

varying vec2 vUv;

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec4  color = texture2D(tDiffuse, vUv);
  float rawD  = texture2D(tDepth,   vUv).r;

  // Background — passthrough
  if (rawD >= 0.9999) {
    gl_FragColor = color;
    return;
  }

  float d = linearizeDepth(rawD);
  if (d <= 0.0) { gl_FragColor = color; return; }
  float logD = log2(d);

  vec2 ts = vec2(uRadius) / uResolution;

  // 8-neighbour sample (cardinal + diagonal at 0.707 weight)
  const int N = 8;
  vec2 offs[8];
  offs[0] = vec2( ts.x,  0.0);
  offs[1] = vec2(-ts.x,  0.0);
  offs[2] = vec2( 0.0,   ts.y);
  offs[3] = vec2( 0.0,  -ts.y);
  offs[4] = vec2( ts.x,  ts.y) * 0.707;
  offs[5] = vec2(-ts.x,  ts.y) * 0.707;
  offs[6] = vec2( ts.x, -ts.y) * 0.707;
  offs[7] = vec2(-ts.x, -ts.y) * 0.707;

  float response = 0.0;
  float weight   = 0.0;

  for (int i = 0; i < N; i++) {
    float nd = texture2D(tDepth, vUv + offs[i]).r;
    if (nd < 0.9999) {
      float ld = linearizeDepth(nd);
      if (ld > 0.0) {
        response += max(0.0, logD - log2(ld));
        weight   += 1.0;
      }
    }
  }

  if (weight > 0.0) response /= weight;

  float shade = exp(-response * 300.0 * uStrength);
  gl_FragColor = vec4(color.rgb * shade, color.a);
}
`

// ─── EdlPass ─────────────────────────────────────────────────────────────────

export class EdlPass {
  constructor(renderer) {
    this._renderer = renderer
    this.enabled   = true
    this.strength  = 0.1
    this.radius    = 1.5

    // Render target with depth texture
    this._rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter:    THREE.NearestFilter,
      magFilter:    THREE.NearestFilter,
      type:         THREE.HalfFloatType,
      depthBuffer:  true,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    })

    // Full-screen quad
    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:    { value: null },
        tDepth:      { value: null },
        uResolution: { value: new THREE.Vector2() },
        uStrength:   { value: this.strength },
        uRadius:     { value: this.radius },
        uNear:       { value: 0.01 },
        uFar:        { value: 100000 },
      },
      vertexShader:   EDL_VERT,
      fragmentShader: EDL_FRAG,
      depthWrite: false,
      depthTest:  false,
    })

    const geo  = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geo, this._mat)
    this._edlScene  = new THREE.Scene()
    this._edlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._edlScene.add(mesh)
  }

  /** Resize internal RT when canvas changes. */
  setSize(w, h) {
    this._rt.setSize(w, h)
    this._mat.uniforms.uResolution.value.set(w, h)
  }

  /**
   * Render scene with EDL post-processing.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(scene, camera) {
    const r = this._renderer

    if (!this.enabled) {
      r.setRenderTarget(null)
      r.render(scene, camera)
      return
    }

    // Update uniforms
    const u = this._mat.uniforms
    u.uStrength.value = this.strength
    u.uRadius.value   = this.radius
    u.uNear.value     = camera.near
    u.uFar.value      = camera.far
    u.tDiffuse.value  = this._rt.texture
    u.tDepth.value    = this._rt.depthTexture

    // Pass 1: scene → render target
    r.setRenderTarget(this._rt)
    r.render(scene, camera)

    // Pass 2: EDL quad → screen
    r.setRenderTarget(null)
    r.render(this._edlScene, this._edlCamera)
  }

  dispose() {
    this._rt.dispose()
    this._mat.dispose()
  }
}
