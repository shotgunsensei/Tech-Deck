import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, LogIn, Shield } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { authFetch, clearCsrfToken } from "@/lib/csrf";
import logoImage from "@assets/ShotgunNinjaVaulticon_1770412982737.png";

const OPERATOROS_URL =
  (import.meta.env.VITE_OPERATOROS_BASE_URL as string | undefined) ||
  "/";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await authFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      clearCsrfToken();

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }

      if (data.requiresMfa) {
        setMfaPending(true);
        setLoading(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      setLocation("/");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await authFetch("/api/auth/mfa/validate", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Invalid code");
        setLoading(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      setLocation("/");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  if (mfaPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-xl" data-testid="text-mfa-title">
              Two-Factor Authentication
            </CardTitle>
            <CardDescription>
              Enter the 6-digit code from your authenticator app, or use a recovery code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfaCode">Authentication Code</Label>
                <Input
                  id="mfaCode"
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="000000"
                  required
                  autoComplete="one-time-code"
                  className="text-center text-lg tracking-widest"
                  maxLength={20}
                  data-testid="input-mfa-code"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-mfa-error">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-mfa-submit">
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Shield className="w-4 h-4 mr-2" />
                )}
                Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-sm"
                onClick={() => {
                  setMfaPending(false);
                  setMfaCode("");
                  setError("");
                }}
                data-testid="button-mfa-back"
              >
                Back to Login
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <img src={logoImage} alt="Tech Deck" className="w-10 h-10 rounded-md object-cover" />
          </div>
          <CardTitle className="text-xl" data-testid="text-login-title">System Admin Sign In</CardTitle>
          <CardDescription>Launch from OperatorOS unless you are using a local admin account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-login-submit">
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              Sign In
            </Button>
            <Button asChild variant="outline" className="w-full" data-testid="link-operatoros-launch">
              <a href={OPERATOROS_URL}>Launch from OperatorOS</a>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
