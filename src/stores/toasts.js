import { ref } from 'vue'

// Tiny global toast system. pushToast() from anywhere; App.vue renders them.
const toasts = ref([])
let _id = 0

export function useToasts() {
  return { toasts }
}

export function pushToast(message, { type = 'info', timeout = 6000 } = {}) {
  const id = ++_id
  toasts.value.push({ id, message, type })
  if (timeout) {
    setTimeout(() => dismissToast(id), timeout)
  }
  return id
}

export function dismissToast(id) {
  const i = toasts.value.findIndex(t => t.id === id)
  if (i !== -1) toasts.value.splice(i, 1)
}
