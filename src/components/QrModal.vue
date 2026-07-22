<script setup>
import { ref, watch, nextTick } from 'vue'
import QRCode from 'qrcode'

const props = defineProps({
  show:      { type: Boolean, default: false },
  address:   { type: String,  default: '' },
  title:     { type: String,  default: 'QR Code' },
  hrAddress: { type: String,  default: '' },   // BitMail (BIP-353), if any
})
const emit = defineEmits(['close'])

const canvas = ref(null)

watch(() => [props.show, props.address], async ([show]) => {
  if (show && props.address) {
    await nextTick()
    if (canvas.value) {
      QRCode.toCanvas(canvas.value, props.address, {
        width: 260,
        margin: 2,
        color: { dark: '#f97316', light: '#080b0f' },
      })
    }
  }
})

function copyText(t) { navigator.clipboard.writeText(t).catch(() => {}) }
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="emit('close')">
    <div class="card modal qr-modal">
      <div class="card-header">
        <h2>{{ title }}</h2>
        <button class="btn btn-ghost btn-sm btn-icon" @click="emit('close')">✕</button>
      </div>
      <div class="card-body qr-body">
        <div class="qr-wrap">
          <canvas ref="canvas"></canvas>
        </div>
        <div v-if="hrAddress" class="addr-display" style="margin-bottom:8px;text-align:center">
          <div class="text-dim text-xs" style="margin-bottom:2px">BitMail</div>
          <span class="mono text-orange" style="font-size:13px;word-break:break-all;line-height:1.5">{{ hrAddress }}</span>
          <div style="margin-top:6px">
            <button class="btn btn-ghost btn-sm" @click="copyText(hrAddress)">⎘ Copy BitMail</button>
          </div>
        </div>
        <div class="addr-display">
          <div v-if="hrAddress" class="text-dim text-xs" style="margin-bottom:2px">SP Address</div>
          <span class="mono text-orange" style="font-size:11px;word-break:break-all;line-height:1.6">
            {{ address }}
          </span>
        </div>
        <div class="flex gap-2 justify-center" style="margin-top:16px">
          <button class="btn btn-ghost btn-sm" @click="copyText(address)">⎘ Copy</button>
          <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-modal { max-width: 340px; }
.qr-body  { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.qr-wrap  {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex; align-items: center; justify-content: center;
}
.qr-wrap canvas { display: block; border-radius: 4px; }
.addr-display {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  text-align: center;
}
@media (max-width: 480px) {
  .qr-modal { max-width: 100%; }
}
</style>
