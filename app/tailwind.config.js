/** @type {import('tailwindcss').Config} */

// All colors route through CSS variables (RGB triplets) so the light/dark
// themes swap at runtime via [data-theme] on <html>. Shade ROLES are stable
// across themes: 950=tinted surface, 900=border, 500=solid, 300/200=text.
function v(name) {
  return `rgb(var(--${name}) / <alpha-value>)`
}
function scale(prefix, shades) {
  const out = {}
  for (const s of shades) out[s] = v(`${prefix}${s}`)
  return out
}

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Any border/divide WITHOUT an explicit color gets the theme edge color
      // (Tailwind's default is gray-200, which is bright text in dark mode).
      borderColor: { DEFAULT: 'rgb(var(--edge) / 1)' },
      divideColor: { DEFAULT: 'rgb(var(--edge) / 1)' },
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        panel2: v('panel2'),
        edge: v('edge'),
        accent: v('accent'),
        muted: v('muted'),
        gray: scale('g', [100, 200, 300, 400, 500, 600]),
        cyan: scale('c', [200, 300, 400, 500, 700, 800, 900, 950]),
        green: scale('gr', [200, 300, 400, 500, 800, 900, 950]),
        red: scale('r', [200, 300, 400, 500, 600, 900, 950]),
        amber: scale('a', [100, 200, 300, 400, 900, 950]),
        yellow: scale('y', [300, 800, 950])
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Consolas', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
