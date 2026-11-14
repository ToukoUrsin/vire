import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { clamp, wrap180 } from '../num'

const IMAGE = new URL('forest/mossy-forest.jpg', document.baseURI).toString()
const PLACEHOLDER = new URL('forest/mossy-forest-placeholder.jpg', document.baseURI).toString()
/** vertical field of view, degrees */
const FOV = 64
const PITCH_MAX = 18
/** the birds sit a little above the horizon */
const BIRD_ELEVATION = 7
/** a mark this close to the edge of the picture is not in view yet (share of the half width) */
const IN_VIEW = 0.86

export interface ForestPanoramaProps {
  /** where the head points; bearings are degrees, + is the person's left */
  yaw: number
  pitch: number
  /** the bird that is calling */
  bird: number | null
  found: number[]
  /** 0..1 of the hold that finds the bird */
  hold: number
  /** the side to turn to, once the person has been told where the bird is */
  hintSide: 'left' | 'right' | null
  reducedMotion: boolean
  onManualYaw(yaw: number): void
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Where a bearing lands in the picture, -1 (left edge) to 1 (right edge), by the shader's own projection.
 * Null when it is behind the person. A turn to the left brings the left of the forest into view, so a bird
 * to the left (a larger bearing) is drawn on the left.
 */
function across(bearing: number, yaw: number, aspect: number): number | null {
  const off = wrap180(bearing - yaw)
  if (Math.abs(off) >= 80) return null
  return -Math.tan(rad(off)) / (aspect * Math.tan(rad(FOV / 2)))
}

/** how far down the picture the birds' height is, in percent, as the head tips */
const down = (pitch: number) => 50 - (50 * Math.tan(rad(BIRD_ELEVATION - clamp(pitch, -PITCH_MAX, PITCH_MAX)))) / Math.tan(rad(FOV / 2))

type Gl = WebGLRenderingContext

const vertexSource = `
  attribute vec2 aPosition;
  uniform float uAspect;
  uniform float uFov;
  uniform float uYaw;
  uniform float uPitch;
  varying vec2 vUv;
  void main() {
    float t = tan(uFov * 0.5);
    vec3 ray = normalize(vec3(aPosition.x * uAspect * t, aPosition.y * t, -1.0));
    float cy = cos(uYaw), sy = sin(uYaw);
    float cp = cos(uPitch), sp = sin(uPitch);
    vec3 yawed = vec3(cy * ray.x + sy * ray.z, ray.y, -sy * ray.x + cy * ray.z);
    vec3 d = vec3(yawed.x, cp * yawed.y - sp * yawed.z, sp * yawed.y + cp * yawed.z);
    vUv = vec2(atan(d.x, -d.z) / (6.28318530718) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const fragmentSource = `
  precision mediump float;
  uniform sampler2D uTexture;
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(uTexture, vUv).rgb;
    // The source is already tonemapped; this tiny lift keeps the forest readable below the copy scrim.
    color = pow(color, vec3(0.96));
    gl_FragColor = vec4(color, 1.0);
  }
`

function compile(gl: Gl, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function makeProgram(gl: Gl): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function drawFallback(ctx: CanvasRenderingContext2D, image: HTMLImageElement, yaw: number, width: number, height: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx.canvas.width = w
    ctx.canvas.height = h
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const sourceW = image.naturalWidth
  const sourceH = image.naturalHeight
  const scale = Math.max(width / sourceW, height / sourceH) * 1.12
  const drawW = sourceW * scale
  const drawH = sourceH * scale
  // a turn to the left (yaw up) slides the picture to the right, as in the shader
  const pan = ((((yaw / 360) * drawW) % drawW) + drawW) % drawW
  const y = (height - drawH) / 2
  const x = width / 2 - drawW / 2 + pan - drawW
  for (let i = 0; i < 3; i++) ctx.drawImage(image, x + i * drawW, y, drawW, drawH)
}

export default function ForestPanorama({ yaw, pitch, bird, found, hold, hintSide, reducedMotion, onManualYaw }: ForestPanoramaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [webgl, setWebgl] = useState(true)
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const yawRef = useRef(yaw)
  const pitchRef = useRef(pitch)
  const contextGeneration = useRef(0)
  yawRef.current = yaw
  pitchRef.current = pitch

  useEffect(() => {
    const image = new Image()
    image.decoding = 'async'
    image.src = IMAGE
    image.onload = () => {
      imageRef.current = image
      setLoaded(true)
    }
    return () => {
      image.onload = null
      imageRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' })
    if (!gl) {
      setWebgl(false)
      return
    }
    const program = makeProgram(gl)
    if (!program) {
      setWebgl(false)
      return
    }
    const position = gl.createBuffer()
    const texture = gl.createTexture()
    if (!position || !texture) {
      setWebgl(false)
      return
    }
    const generation = ++contextGeneration.current
    gl.bindBuffer(gl.ARRAY_BUFFER, position)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 17, 13, 0]))
    const aPosition = gl.getAttribLocation(program, 'aPosition')
    const uAspect = gl.getUniformLocation(program, 'uAspect')
    const uFov = gl.getUniformLocation(program, 'uFov')
    const uYaw = gl.getUniformLocation(program, 'uYaw')
    const uPitch = gl.getUniformLocation(program, 'uPitch')
    let uploadedImage: HTMLImageElement | null = null
    const render = () => {
      const image = imageRef.current
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (!image) return
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (uploadedImage !== image) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        uploadedImage = image
      }
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, position)
      gl.enableVertexAttribArray(aPosition)
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0)
      gl.uniform1f(uAspect, width / height)
      gl.uniform1f(uFov, (FOV * Math.PI) / 180)
      gl.uniform1f(uYaw, (yawRef.current * Math.PI) / 180)
      gl.uniform1f(uPitch, (clamp(pitchRef.current, -PITCH_MAX, PITCH_MAX) * Math.PI) / 180)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    let raf = 0
    let active = document.visibilityState === 'visible'
    const frame = () => {
      if (!active) return
      render()
      raf = requestAnimationFrame(frame)
    }
    const visibility = () => {
      active = document.visibilityState === 'visible'
      if (active && !raf) raf = requestAnimationFrame(frame)
      if (!active && raf) cancelAnimationFrame(raf)
      if (!active) raf = 0
    }
    document.addEventListener('visibilitychange', visibility)
    raf = requestAnimationFrame(frame)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      if (raf) cancelAnimationFrame(raf)
      window.setTimeout(() => {
        if (contextGeneration.current !== generation) return
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }, 0)
      gl.deleteTexture(texture)
      gl.deleteBuffer(position)
      gl.deleteProgram(program)
    }
  }, [loaded])

  useEffect(() => {
    if (webgl) return
    const canvas = canvasRef.current
    const image = imageRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !image) return
    let raf = 0
    let active = document.visibilityState === 'visible'
    const render = () => {
      if (!active) return
      const rect = canvas.getBoundingClientRect()
      drawFallback(ctx, image, yawRef.current, rect.width, rect.height)
      raf = requestAnimationFrame(render)
    }
    const visibility = () => {
      active = document.visibilityState === 'visible'
      if (active && !raf) raf = requestAnimationFrame(render)
      if (!active && raf) cancelAnimationFrame(raf)
      if (!active) raf = 0
    }
    document.addEventListener('visibilitychange', visibility)
    raf = requestAnimationFrame(render)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [webgl, loaded])

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: event.clientX, yaw: yawRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current
    if (!active) return
    // the forest follows the finger: dragging it to the right is a turn to the left
    const next = active.yaw + (event.clientX - active.x) * 0.38
    onManualYaw(wrap180(next))
  }
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const box = canvasRef.current
  const aspect = box && box.clientHeight ? box.clientWidth / box.clientHeight : 0.75
  const top = `${down(pitch)}%`
  const spot = (bearing: number) => {
    const x = across(bearing, yaw, aspect)
    return x != null && Math.abs(x) < IN_VIEW ? `${50 + 50 * x}%` : null
  }
  const birdAt = bird == null ? null : spot(bird)

  return (
    <div className="va-forest-panorama" style={{ backgroundImage: `url(${PLACEHOLDER})` }}>
      <img className={`va-forest-placeholder${loaded ? ' is-loaded' : ''}`} src={PLACEHOLDER} alt="" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className={`va-forest-webgl${loaded ? ' is-loaded' : ''}`}
        aria-label="A forest all around you. Drag to look around."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <div className="va-forest-marks" aria-hidden="true">
        {found.map((bearing, i) => {
          const left = spot(bearing)
          return left && <span className="va-forest-found" key={i} style={{ left, top }} />
        })}
        {birdAt && (
          <span className="va-forest-bird" data-held={hold > 0 || undefined} style={{ left: birdAt, top, ['--hold' as string]: hold.toFixed(3) }}>
            <i />
          </span>
        )}
        {hintSide && !birdAt && (
          <span className="va-forest-edge" data-side={hintSide}>
            <i />
          </span>
        )}
      </div>
      {!webgl && <span className="va-forest-fallback-note">Drag to look around</span>}
      {reducedMotion && <span className="va-sr-only">Motion is reduced. Drag the forest to look around.</span>}
    </div>
  )
}
