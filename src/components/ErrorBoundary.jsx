import { Component } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// The app's only class component: error boundaries need componentDidCatch.
// `silent` drops the crashed subtree instead of showing the fallback (used for
// the floating chat, where losing the widget must not cost the whole screen).
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('render crash', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="text-center py-24 px-4">
        <p className="text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-muted-foreground mb-6">This screen hit an unexpected error. Reloading usually fixes it.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw className="w-4 h-4 me-2" /> Reload
        </Button>
      </div>
    );
  }
}
