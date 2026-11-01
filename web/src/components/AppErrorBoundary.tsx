import { Component, type ReactNode } from 'react'
import { Button } from './ui'

/** A failed editor or lazy chunk should leave recovery controls, not a blank page. */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="min-h-screen bg-bg text-ink p-6 flex items-center justify-center">
      <div role="alert" className="max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">LocalFirst could not display this screen</h1>
        <p>Try reloading the app or returning to your files. Do not clear browser data while recovering your work.</p>
        <p>If you were editing, check for a recovery draft when you reopen the document. Changes that had not finished saving may need recovery.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => window.location.reload()}>Reload app</Button>
          <Button onClick={() => window.location.assign('/docs')}>Return to files</Button>
        </div>
      </div>
    </main>
  }
}
