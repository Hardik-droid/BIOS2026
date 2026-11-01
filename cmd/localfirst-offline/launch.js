const status = document.getElementById('status')
const retry = document.getElementById('retry')
const progress = document.getElementById('progress')

function workerVersion(worker) {
  return new Promise(resolve => {
    if (!worker) return resolve('')
    const channel = new MessageChannel()
    const finish = version => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(version)
    }
    const timer = setTimeout(() => finish(''), 750)
    channel.port1.onmessage = event => finish(event.data?.cacheVersion || '')
    try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]) }
    catch { finish('') }
  })
}

async function openCurrentApp() {
  retry.hidden = true
  progress.hidden = false
  document.querySelector('main').setAttribute('aria-busy', 'true')
  status.textContent = 'Updating the app on this device…'
  try {
    const response = await fetch('/api/offline-launch-health', { cache: 'no-store' })
    const health = await response.json()
    if (!response.ok || health.server !== 'localfirst-offline' || !health.cache_version) throw new Error('Run the updated Windows offline launcher, then try again.')
    if (!('serviceWorker' in navigator)) { location.replace('/'); return }
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    await registration.update()
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      if (await workerVersion(registration.active) === health.cache_version) {
        // Other app tabs are deliberately left in place; no editor is reloaded.
        location.replace('/')
        return
      }
      if (registration.installing?.state === 'redundant') throw new Error('The app update could not finish. Check available storage and try again.')
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error('The update did not finish. Keep the Windows launcher running and try again. Your saved files have not been removed.')
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'LocalFirst could not open. Try again.'
    progress.hidden = true
    document.querySelector('main').setAttribute('aria-busy', 'false')
    retry.hidden = false
  }
}
retry.addEventListener('click', () => { void openCurrentApp() })
void openCurrentApp()
