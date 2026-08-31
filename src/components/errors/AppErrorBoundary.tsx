import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { hardReload } from '@/lib/version';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryKey: number;
}

function normaliseError(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const readProp = (key: string): string | undefined => {
      const val = obj[key] ?? Object.getOwnPropertyDescriptor(obj, key)?.value;
      return val != null ? String(val) : undefined;
    };
    const message = readProp('message') || readProp('hint') || readProp('details') || readProp('code') || readProp('error') || JSON.stringify(raw);
    const err = new Error(message || 'Unknown error (empty object)');
    err.stack = readProp('stack') || err.stack;
    return err;
  }
  if (typeof raw === 'string') return new Error(raw);
  return new Error('Unknown error');
}

function isEmptyNativeArtifact(raw: unknown): boolean {
  if (typeof raw === 'string') return /multi_header\.length|multi_header/i.test(raw);
  if (!raw || typeof raw !== 'object') return false;
  if (raw instanceof Error && !String(raw.message ?? '').trim()) return true;
  const obj = raw as Record<string, unknown>;
  const keys = new Set([...Object.keys(obj), ...Object.getOwnPropertyNames(obj)]);
  const hasOnlyGeneratedErrorFields = [...keys].every((key) => ['stack', 'name', 'message', 'errorMessage'].includes(key));
  for (const key of ['message', 'errorMessage', 'code', 'details', 'hint', 'error']) {
    const value = obj[key] ?? Object.getOwnPropertyDescriptor(obj, key)?.value;
    if (/multi_header\.length|multi_header/i.test(String(value ?? ''))) return true;
    if (value != null && String(value).trim()) return false;
  }
  return keys.size === 0 || hasOnlyGeneratedErrorFields;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null, errorInfo: null, retryKey: 0 };

  public static getDerivedStateFromError(raw: unknown): Partial<State> | null {
    if (isEmptyNativeArtifact(raw)) return { hasError: false, error: null, errorInfo: null };
    return { hasError: true, error: normaliseError(raw) };
  }

  public componentDidCatch(raw: unknown, errorInfo: ErrorInfo) {
    if (isEmptyNativeArtifact(raw)) {
      this.setState((state) => ({ hasError: false, error: null, errorInfo: null, retryKey: state.retryKey + 1 }));
      return;
    }
    const error = normaliseError(raw);
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    
    // Auto-trigger hard reload if a chunk error bubbled up (failsafe for lazyWithRetry)
    const msg = error.message.toLowerCase();
    if (/chunk|loading|fetch|module|importing/i.test(msg)) {
      console.warn('[ErrorBoundary] Detected chunk failure, triggering robust reload...');
      hardReload('boundary-chunk-error');
    }

    this.setState({ errorInfo });
  }

  private handleReload = () => {
    hardReload('manual-boundary-reload');
  };

  private handleGoBack = () => {
    window.history.back();
  };

  private handleReset = () => {
    this.setState((state) => ({ hasError: false, error: null, errorInfo: null, retryKey: state.retryKey + 1 }));
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-destructive/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
              <p className="text-muted-foreground">A runtime error occurred. If this persists, please try the robust reload below.</p>
            </div>
            {this.state.error && (
              <div className="text-left bg-muted/50 rounded-lg p-4 overflow-auto max-h-60">
                <p className="text-sm font-mono text-destructive break-all">{this.state.error.toString()}</p>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={this.handleGoBack} className="gap-2"><ArrowLeft className="w-4 h-4" /> Back</Button>
              <Button onClick={this.handleReset} className="gap-2"><RefreshCw className="w-4 h-4" /> Retry</Button>
              <Button variant="ghost" onClick={this.handleReload} className="gap-2">Update & Reload</Button>
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
