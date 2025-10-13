"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api-client";
import { toast } from "sonner";

type Step = "email" | "otp" | "success";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(60);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  const beginResendCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    setCanResend(false);
    setResendCountdown(60);
    let remaining = 60;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        setResendCountdown(0);
        setCanResend(true);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      } else {
        setResendCountdown(remaining);
      }
    }, 1000);
  };

  const buildIdentityPayload = () => {
    const value = identifier.trim();
    if (!value) {
      toast.error("Enter your email or recipient ID");
      return null;
    }

    if (value.includes("@")) {
      return { email: value.toLowerCase() } as const;
    }

    return { recipientId: value } as const;
  };

  const handleRequestOtp = async () => {
    if (isLoading) return;

    const identity = buildIdentityPayload();
    if (!identity) return;

    setIsLoading(true);

    try {
      await apiClient.post("/auth/recipient/start", identity);
      setStep("otp");
      beginResendCountdown();
      toast.success("Check your inbox for your one-time code");
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

  const handleVerifyOtp = async () => {
    if (isLoading) return;
    const identity = buildIdentityPayload();
    if (!identity) return;

    setIsLoading(true);

    try {
      await apiClient.post("/auth/recipient/verify", { ...identity, otp });
      setStep("success");
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
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
    const identity = buildIdentityPayload();
    if (!identity) {
      return;
    }

    setIsLoading(true);
    beginResendCountdown();

    try {
      await apiClient.post("/portal/auth/otp/resend", identity);
      toast.success("We just sent another code");
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
      setResendCountdown(0);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mx-auto w-full max-w-[520px] rounded-[36px] border border-white/12 bg-[#cacbcc]/95 px-10 py-12 text-center text-zinc-900 shadow-[0_40px_90px_-50px_rgba(0,0,0,0.9)] backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1f2226] sm:text-[28px]">
            Download Portal
          </h1>
          <p className="mt-3 text-[#1f2226] text-sm text-zinc-600">
            Enter your email or RID to get started
          </p>

          {step === "email" && (
            <form action="noop" className="mt-10 space-y-5">
              <fieldset className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <label htmlFor="identifier" className="sr-only">
                  Email address or recipient ID
                </label>
                <Input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter your email or RID"
                  autoComplete="username"
                  required
                  autoFocus
                  disabled={isLoading}
                  className="h-12 w-full max-w-[260px] rounded-2xl border border-white/40 bg-white px-4 text-base text-[#191c1f] placeholder:text-zinc-500 shadow-[0_2px_0_rgba(17,18,21,0.08)_inset]"
                />
                <Button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isLoading}
                  className="h-12 rounded-2xl bg-[#58595b] px-7 text-sm font-semibold tracking-wide text-white transition hover:bg-[#434446]"
                >
                  {isLoading ? "Sending..." : "Login"}
                </Button>
              </fieldset>
            </form>
          )}

          {step === "otp" && (
            <div className="mt-10 space-y-6">
              <div className="space-y-1 text-sm text-[#1f2226]">
                <p className="text-zinc-600">We sent a one-time code to</p>
                <p className="font-medium">{identifier}</p>
              </div>

              <form
                onSubmit={handleVerifyOtp}
                action="noop"
                className="mx-auto flex w-full max-w-[320px] flex-col gap-4"
              >
                <label htmlFor="otp" className="sr-only">
                  One-time code
                </label>
                <Input
                  id="otp"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter your code"
                  maxLength={6}
                  required
                  autoFocus
                  disabled={isLoading}
                  className="h-12 rounded-2xl border border-white/40 bg-white text-center text-lg tracking-[0.45em] text-[#1f2226] placeholder:tracking-normal"
                />
                <Button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={isLoading}
                  className="h-12 rounded-2xl bg-[#58595b] text-sm font-semibold tracking-wide text-white transition hover:bg-[#434446]"
                >
                  {isLoading ? "Verifying..." : "Verify & continue"}
                </Button>
              </form>

              <div className="space-y-2 text-sm text-zinc-600">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isLoading || !canResend}
                  className="font-medium text-[#34363a] transition hover:text-[#1f2226] disabled:cursor-not-allowed disabled:text-zinc-400"
                >
                  {canResend
                    ? "Resend code"
                    : `Resend available in ${resendCountdown.toString().padStart(2, "0")}s`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                    setCanResend(false);
                    setResendCountdown(60);
                    if (countdownRef.current) {
                      clearInterval(countdownRef.current);
                      countdownRef.current = null;
                    }
                  }}
                  disabled={isLoading}
                  className="block w-full text-[#73747a] transition hover:text-[#4a4c52] disabled:cursor-not-allowed"
                >
                  Use a different email or RID
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="mt-12 space-y-5">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#3abf7a] text-3xl font-semibold text-white">
                ✓
              </div>
              <p className="text-lg font-medium text-[#1f2226]">You&apos;re logged in</p>
              <p className="text-sm text-zinc-600">Redirecting you now…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
