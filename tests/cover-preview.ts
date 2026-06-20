// Standalone cover preview: renders buildCover() into the page so the design
// can be eyeballed and tweaked in a browser without loading the plugin.
// Build: npx esbuild tests/cover-preview.ts --bundle --outfile=docs/cover-preview.js
import { buildCover } from '../src/cover'

async function render(title: string) {
  const out = document.getElementById('out')!
  out.innerHTML = 'Rendering…'
  const cover = await buildCover(title)
  if (!cover) { out.textContent = 'Canvas unavailable.'; return }
  const url = URL.createObjectURL(new Blob([cover.bytes], { type: cover.mediaType }))
  out.innerHTML = ''
  const img = document.createElement('img')
  img.src = url
  img.style.height = '80vh'
  img.style.boxShadow = '0 8px 40px rgba(0,0,0,.4)'
  out.appendChild(img)
}

const input = document.getElementById('title') as HTMLInputElement
document.getElementById('go')!.addEventListener('click', () => void render(input.value))
void render(input.value || 'Change Management')
