import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

const app = createApp(App)

// Log render/lifecycle errors to console (no DOM manipulation)
app.config.errorHandler = (err, instance, info) => {
  console.error('[VUE ERROR]', info, err)
}
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED PROMISE]', e.reason)
})

app.use(createPinia()).use(router).mount('#app')
