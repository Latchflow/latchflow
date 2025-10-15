"use client";

import { useEffect, useRef, useState } from "react";
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
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-[300px] w-4/5 max-w-[800px] rounded-[24px] bg-[#B5B5B5]/95 px-10 py-[12px] flex flex-col items-center justify-evenly">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1f2226] sm:text-[28px] p-[0px] m-[0px]">
          Download Portal
        </h1>

        {step === "email" && (
          <div className="w-1/2 flex flex-col items-center gap-[14px]">
            <input
              id="email-field"
              type="text"
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Enter your email or RID"
              required
              autoFocus
              disabled={isLoading}
              className="w-full h-[54px] rounded-[16px] bg-[#FFFFFF] text-[20px] text-[#000000] placeholder:text-[#9D9D9D] px-[20px] border-none"
            />
            <button
              type="button"
              onClick={handleRequestOtp}
              disabled={isLoading}
              className="h-[38px] w-1/5 rounded-[7px] bg-[#58595b] hover:bg-[#464749] text-base font-semibold text-white self-end border-none"
            >
              {isLoading ? "Sending..." : "Login"}
            </button>
          </div>
        )}

        {step === "otp" && (
          <>
            <p className="text-zinc-600 text-[#000000]">Check your email for a one-time code</p>
            <div className="w-1/2 flex flex-col items-center gap-[14px]">
              <label htmlFor="otp" className="sr-only">
                One-time code
              </label>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter your code"
                maxLength={6}
                required
                autoFocus
                disabled={isLoading}
                className="w-full h-[54px] rounded-[16px] bg-[#FFFFFF] text-[20px] text-center text-[#000000] placeholder:text-[#9D9D9D]  px-[20px] border-none"
              />
              <div className="w-full flex items-center justify-end gap-[12px]">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isLoading || !canResend}
                  className="h-[38px] w-1/5 rounded-[7px] bg-[#58595b] hover:bg-[#464749] text-base font-semibold text-white self-end border-none"
                >
                  {canResend
                    ? "Resend code"
                    : `Resend available in ${resendCountdown.toString().padStart(2, "0")}s`}
                </button>
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={isLoading}
                  className="h-[38px] w-1/5 rounded-[7px] bg-[#58595b] hover:bg-[#464749] text-base font-semibold text-white self-end border-none"
                >
                  {isLoading ? "Verifying..." : "Continue"}
                </button>
              </div>
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
                className="block h-[24px] rounded-[4px] w-1/2 text-[#FFFFFF] transition hover:text-[#4a4c52] disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </>
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
  );
}
