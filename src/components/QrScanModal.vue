<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { Capacitor } from '@capacitor/core'

const props = defineProps({
  show: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'scanned'])

const isNative = Capacitor.isNativePlatform && Capacitor.isNativePlatform()

const video      = ref(null)
const error      = ref('')
const supported  = ref(true)
const cameras    = ref([])   // enumerated video inputs, for manual switching
const camIndex   = ref(0)    // which camera is currently active
let stream       = null
let detector     = null
let rafId        = null
let scanning     = false

function stop() {
  scanning = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    stream = null
  }
}

// Pull a QR string out of whatever was scanned. The receive QR encodes the bare
// address (sp1…/tsp1…/bc1…/BitMail). Defensively strip a bitcoin: URI prefix and
// any query params, in case a URI-style QR is scanned.
function normalize(raw) {
  let v = (raw || '').trim()
  if (!v) return ''
  const low = v.toLowerCase()
  if (low.startsWith('bitcoin:')) {
    v = v.slice('bitcoin:'.length)
    const q = v.indexOf('?')
    if (q !== -1) v = v.slice(0, q)
  }
  return v.trim()
}

let _canvas = null
async function tick() {
  if (!scanning || !detector || !video.value) return
  const v = video.value
  // Only detect once the video has a current frame; detecting earlier reads a
  // black frame.
  if (v.readyState < 2 || !v.videoWidth) {
    rafId = requestAnimationFrame(tick); return
  }
  try {
    // Detect on a canvas snapshot rather than the live <video> element — some
    // Android Chrome/WebView builds return no results detecting straight off a
    // video element, but work fine off a canvas/ImageBitmap.
    if (!_canvas) _canvas = document.createElement('canvas')
    _canvas.width = v.videoWidth
    _canvas.height = v.videoHeight
    const ctx = _canvas.getContext('2d')
    ctx.drawImage(v, 0, 0, _canvas.width, _canvas.height)
    const codes = await detector.detect(_canvas)
    if (codes && codes.length) {
      const value = normalize(codes[0].rawValue)
      if (value) {
        emit('scanned', value)
        close()
        return
      }
    }
  } catch { /* transient decode error — keep trying */ }
  // ~10 fps is plenty for QR and lighter than every animation frame.
  setTimeout(() => { rafId = requestAnimationFrame(tick) }, 100)
}

const needsTap    = ref(false)   // show an in-modal "Enable camera" button

async function start() {
  error.value = ''
  needsTap.value = false
  // Feature-detect: BarcodeDetector is available in Android Chrome / WebView
  // (the primary target) and Chromium desktop. Fall back with a clear message
  // elsewhere so the user just pastes instead.
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
    supported.value = false
    return
  }
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats?.()
    if (formats && !formats.includes('qr_code')) { supported.value = false; return }
    detector = new window.BarcodeDetector({ formats: ['qr_code'] })
  } catch {
    supported.value = false
    return
  }

  // NOTE: we deliberately do NOT gate on navigator.permissions.query({name:'camera'})
  // here. On several mobile browsers that query returns 'denied' even when the
  // real state is 'ask' (site settings show "Ask first"), which would wrongly
  // block us from ever calling getUserMedia. getUserMedia itself is the
  // authoritative action — it triggers the actual permission prompt — so we
  // always attempt it and interpret the real error if one occurs.
  await openCamera()
}

async function openCamera() {
  error.value = ''
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    error.value = 'This browser can’t access the camera. Paste the address instead.'
    return
  }
  // Enumerate cameras so we can (a) best-guess the rear one and (b) offer a
  // manual flip button — some Android Chrome builds ignore facingMode entirely
  // and hand back the front camera, so a manual switch is the reliable escape.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    probe.getTracks().forEach(t => t.stop())
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameras.value = devices.filter(d => d.kind === 'videoinput')
    // Choose the rear camera. Match 'back/rear/environment' first; otherwise
    // pick the first camera that is NOT front/user-facing; else fall back to the
    // last enumerated camera (usually the main rear on phones).
    let idx = cameras.value.findIndex(d => /back|rear|environment/i.test(d.label || ''))
    if (idx < 0) idx = cameras.value.findIndex(d => !/front|user|face|selfie/i.test(d.label || ''))
    if (idx < 0) idx = cameras.value.length > 1 ? cameras.value.length - 1 : 0
    camIndex.value = idx
  } catch { cameras.value = []; camIndex.value = 0 }

  await openStream()
}

// Open the stream for the currently selected camera (by deviceId when known,
// else by facingMode/any).
async function openStream() {
  error.value = ''
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    error.value = 'This browser can’t access the camera. Paste the address instead.'
    return
  }
  const cam = cameras.value[camIndex.value]
  let lastErr = null
  const attempts = []
  if (cam && cam.deviceId) {
    attempts.push({ video: { deviceId: { exact: cam.deviceId } }, audio: false })
  }
  attempts.push({ video: { facingMode: { exact: 'environment' } }, audio: false })
  attempts.push({ video: { facingMode: 'environment' }, audio: false })
  attempts.push({ video: true, audio: false })
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      lastErr = null
      break
    } catch (e) {
      lastErr = e
      stream = null
    }
  }
  if (!stream) {
    const e = lastErr || {}
    const name = e.name
    if (name === 'NotAllowedError') {
      needsTap.value = true
      error.value = 'Camera permission is needed. Tap “Enable camera” below. If nothing happens, camera access is blocked in your browser’s site settings and must be re-enabled there.'
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      error.value = 'No camera found on this device. Paste the address instead.'
    } else if (name === 'NotReadableError') {
      error.value = 'The camera is in use by another app. Close it and try again, or paste the address.'
    } else {
      error.value = 'Could not open the camera. Paste the address instead.'
    }
    return
  }
  needsTap.value = false
  await nextTick()
  if (!video.value) return
  const v = video.value
  v.srcObject = stream
  v.setAttribute('playsinline', '')   // iOS/Safari inline playback
  v.muted = true
  // Wait until the video actually has frames before scanning — detecting on a
  // not-yet-playing video yields a black frame and no results.
  await new Promise((resolve) => {
    let done = false
    const go = () => { if (!done) { done = true; resolve() } }
    v.onloadedmetadata = go
    v.oncanplay = go
    setTimeout(go, 1500)   // fallback so we never hang
  })
  try { await v.play() } catch { /* ignore autoplay quirks */ }
  scanning = true
  rafId = requestAnimationFrame(tick)
}

// Manually switch to the next camera — the reliable escape when the browser
// auto-selects the front camera and ignores facingMode.
async function flipCamera() {
  if (cameras.value.length < 2) return
  scanning = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  camIndex.value = (camIndex.value + 1) % cameras.value.length
  await openStream()
}

function close() {
  stop()
  emit('close')
}

// NATIVE (Android app): use the MLKit barcode scanner plugin. It opens the
// platform camera (reliable rear camera, fast decode) and returns the value —
// avoiding the WebView getUserMedia camera-selection problems entirely.
async function scanNative() {
  error.value = ''
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')

    // Ensure the on-device scanning module is available (Google Barcode UI).
    try {
      const avail = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
      if (!avail.available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule()
      }
    } catch { /* older plugin/devices: scan() still works without this */ }

    // Permission
    let perm = await BarcodeScanner.checkPermissions()
    if (perm.camera !== 'granted') {
      perm = await BarcodeScanner.requestPermissions()
    }
    if (perm.camera !== 'granted') {
      error.value = 'Camera permission is needed to scan. Enable it in Settings, or paste the address instead.'
      return
    }

    const { barcodes } = await BarcodeScanner.scan({ formats: ['QR_CODE'] })
    if (barcodes && barcodes.length) {
      const value = normalize(barcodes[0].rawValue || barcodes[0].displayValue || '')
      if (value) {
        emit('scanned', value)
        close()
        return
      }
    }
    // No code scanned (user cancelled) — just close quietly.
    close()
  } catch (e) {
    error.value = 'Could not open the scanner. Paste the address instead.'
  }
}

watch(() => props.show, async (show) => {
  if (show) {
    supported.value = true
    error.value = ''
    if (isNative) {
      // Native scanner: no in-modal video preview needed.
      scanNative()
      return
    }
    await nextTick()
    start()
  } else {
    stop()
  }
})

onBeforeUnmount(stop)
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="card modal qr-modal">
      <div class="card-header">
        <h2>Scan QR code</h2>
        <button class="btn btn-ghost btn-sm btn-icon" @click="close">✕</button>
      </div>
      <div class="card-body qr-body">
        <!-- Native (Android app): MLKit opens a full-screen system scanner, so
             the modal just shows status here. -->
        <template v-if="isNative">
          <div v-if="error" class="alert alert-warn" style="margin:8px 0">⚠ {{ error }}</div>
          <div v-else class="text-dim text-sm" style="text-align:center;padding:16px">
            Opening the camera scanner…
          </div>
        </template>

        <!-- Web (browser): in-modal camera preview via BarcodeDetector. -->
        <template v-else>
          <div v-if="!supported" class="text-dim text-sm" style="text-align:center;padding:16px">
            QR scanning isn't supported on this browser. Please paste the address instead.
          </div>
          <div v-else-if="error" class="alert alert-warn" style="margin:8px 0">⚠ {{ error }}</div>
          <div v-if="needsTap" style="text-align:center;margin:10px 0">
            <button class="btn btn-primary" @click="openCamera">Enable camera</button>
          </div>
          <div v-show="supported && !error" class="qr-scan-wrap">
            <video ref="video" autoplay playsinline muted class="qr-scan-video"></video>
            <div class="qr-scan-frame"></div>
          </div>
          <p v-if="supported && !error" class="text-dim text-xs" style="text-align:center;margin-top:10px">
            Point the camera at the recipient's QR code.
          </p>
          <div v-if="supported && !error && cameras.length > 1" style="text-align:center;margin-top:8px">
            <button class="btn btn-ghost btn-sm" @click="flipCamera">🔄 Switch camera</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-scan-wrap { position: relative; width: 100%; max-width: 320px; margin: 0 auto; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; background: #000; }
.qr-scan-video { width: 100%; height: 100%; object-fit: cover; }
.qr-scan-frame { position: absolute; inset: 12%; border: 2px solid #f97316; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.25); pointer-events: none; }
</style>
