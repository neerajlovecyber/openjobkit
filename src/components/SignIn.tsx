import React, { useState } from 'react'

import { db } from '@/lib/db'

interface SignInProps {
  compact?: boolean
}

export default function SignIn({ compact = false }: SignInProps) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError(null)
    try {
      await db.auth.sendMagicCode({ email })
      setStep('code')
      setSuccessMsg(`Sent code to ${email}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code) return
    setLoading(true)
    setError(null)
    try {
      await db.auth.signInWithMagicCode({ email, code })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (compact) {
    return (
      <div className="w-full bg-[#0f0f13] px-4 py-4 font-[Inter,sans-serif] text-white">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold shadow-md shadow-violet-500/10">
            J
          </div>
          <h2 className="text-sm font-bold tracking-tight">
            Sign in to OpenJobKit
          </h2>
          <p className="mt-1 text-[11px] text-white/40">
            Magic login code will be sent to your inbox
          </p>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="mb-3 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[10px] text-violet-300">
            {successMsg}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white transition-all hover:bg-violet-500 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Sending Code...' : 'Send Magic Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                Magic Code
              </label>
              <input
                type="text"
                required
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-center font-mono text-xs tracking-widest text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setError(null)
                  setSuccessMsg(null)
                }}
                className="flex-1 cursor-pointer rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition-all hover:bg-white/10 active:scale-[0.98]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-[2] cursor-pointer rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white transition-all hover:bg-violet-500 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  // Full-width elegant flat layout (no boxed nested card, clean centering)
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0f0f13] px-6 font-[Inter,sans-serif] text-white">
      {/* Background soft radial glow */}
      <div className="absolute top-1/2 left-1/2 -z-10 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/5 blur-[120px]" />

      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-xl font-bold shadow-lg shadow-violet-500/10">
          J
        </div>
        <h2 className="text-xl font-bold tracking-tight">OpenJobKit</h2>
        <p className="mt-2 text-xs text-white/40">
          Enter your email to sign in or sign up automatically.
        </p>

        <div className="mt-8 text-left">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-xs text-violet-300">
              {successMsg}
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full cursor-pointer rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Sending Code...' : 'Send Magic Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                  Magic Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-center font-mono text-sm tracking-widest text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep('email')
                    setError(null)
                    setSuccessMsg(null)
                  }}
                  className="flex-1 cursor-pointer rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/10 active:scale-[0.98]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] cursor-pointer rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
