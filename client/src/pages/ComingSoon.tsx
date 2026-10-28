import { Button } from "@/components/ui/button";
import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";

interface ComingSoonProps {
  error?: Error;
  resetError?: () => void;
  isDevelopment?: boolean;
}

export default function ComingSoon({ error, resetError, isDevelopment = false }: ComingSoonProps) {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-md w-full mx-4">
        <div className="text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-orange-500/20 rounded-full blur-xl" />
              <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
                <AlertCircle className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">Coming Soon</h1>
            <p className="text-slate-400">
              This feature is currently under development
            </p>
          </div>

          {/* Description */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 space-y-2">
            <p className="text-sm text-slate-300">
              We're working hard to bring you an amazing experience. Please check back soon!
            </p>
            {isDevelopment && error && (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <p className="text-xs text-orange-400 font-mono break-words">
                  {error.message}
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => navigate("/")}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              <Home className="w-4 h-4 mr-2" />
              Go Home
            </Button>
            {resetError && (
              <Button
                onClick={resetError}
                variant="outline"
                className="flex-1 border-slate-600 hover:bg-slate-800"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            )}
          </div>

          {/* Footer */}
          <div className="text-xs text-slate-500 pt-4">
            <p>Smart Factory v1.0.0</p>
          </div>
        </div>
      </div>
    </div>
  );
}
