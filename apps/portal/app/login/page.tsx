"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api-client";
import { toast } from "sonner";

type Step = "email" | "otp" | "success";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canResend, setCanResend] = useState(false);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiClient.post("/auth/recipient/start", { email });
      setStep("otp");
      setCanResend(false);
      toast.success("Check your email for your one-time code");

      // Allow resend after 60 seconds
      setTimeout(() => setCanResend(true), 60000);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          toast.error("Too many requests. Please try again later.");
        } else {
          toast.error(error.message || "Failed to send code");
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiClient.post("/auth/recipient/verify", { email, otp });
      setStep("success");
      toast.success("Login successful! Redirecting...");

      // Redirect to home page
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          toast.error("Invalid or expired code");
        } else if (error.status === 429) {
          toast.error("Too many attempts. Please try again later.");
        } else {
          toast.error(error.message || "Verification failed");
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsLoading(true);
    setCanResend(false);

    try {
      await apiClient.post("/portal/auth/otp/resend", { email });
      toast.success("A new code has been sent to your email");

      // Allow resend again after 60 seconds
      setTimeout(() => setCanResend(true), 60000);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          toast.error("Too many requests. Please try again later.");
        } else {
          toast.error(error.message || "Failed to resend code");
        }
      } else {
        toast.error("An unexpected error occurred");
      }
      setCanResend(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Latchflow Portal</h1>
          <p className="mt-2 text-sm text-gray-600">Access your secure files</p>
        </div>

        <div className="bg-white p-8 rounded-lg shadow-sm border">
          {step === "email" && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Sending..." : "Send code"}
              </Button>
            </form>
          )}

          {step === "otp" && (
            <div className="space-y-4">
              <div className="text-center space-y-2 pb-4">
                <p className="text-sm text-gray-600">We&apos;ve sent a one-time code to</p>
                <p className="font-medium">{email}</p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="otp" className="block text-sm font-medium">
                    One-time code
                  </label>
                  <Input
                    id="otp"
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    maxLength={6}
                    required
                    autoFocus
                    disabled={isLoading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Verifying..." : "Verify code"}
                </Button>
              </form>

              <div className="pt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isLoading || !canResend}
                  className="text-sm text-blue-600 hover:text-blue-500 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {canResend ? "Resend code" : "Resend available in 60s"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                  }}
                  disabled={isLoading}
                  className="block text-sm text-gray-600 hover:text-gray-500"
                >
                  Use a different email
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="text-center space-y-4">
              <div className="text-green-600 text-4xl">✓</div>
              <p className="font-medium">Login successful</p>
              <p className="text-sm text-gray-600">Redirecting you now...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
