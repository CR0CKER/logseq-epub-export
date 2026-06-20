// Full-size cover render for headless screenshotting. Draws buildCover() at its
// natural pixel size into the page so a 1600x2400 screenshot IS the cover.
import { buildCover } from '../src/cover'

;(async () => {
  const title = new URLSearchParams(location.search).get('t') || 'Change Management'
  const cover = await buildCover(title)
  document.body.style.margin = '0'
  if (!cover) { document.body.textContent = 'no cover'; return }
  const img = new Image()
  img.src = URL.createObjectURL(new Blob([cover.bytes], { type: cover.mediaType }))
  img.style.display = 'block'
  img.style.width = '800px'
  img.onload = () => { (window as any).__coverReady = true }
  document.body.appendChild(img)
})()
