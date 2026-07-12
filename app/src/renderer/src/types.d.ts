import type { MissionApi } from '../../preload/index'

declare global {
  interface Window {
    api: MissionApi
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string
          useragent?: string
        },
        HTMLElement
      >
    }
  }
}

/** Minimal surface of Electron's WebviewTag we actually use. */
export interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  insertText(text: string): Promise<void>
}

export {}
