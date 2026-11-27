'use client';

import React, { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your university email...');
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;

    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Verification failed.');
        }
        setStatus('success');
        setMessage(data.message || 'Email verified successfully! You can now sign in.');
      })
      .catch((err: any) => {
        setStatus('error');
        setMessage(err.message || 'Verification link is invalid or has expired.');
      });
  }, [token]);

  return (
    <main className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-lg border border-gray-100 text-center space-y-4">
        {status === 'loading' && (
          <>
            <RefreshCw className="w-10 h-10 text-[#F58220] animate-spin mx-auto" />
            <h1 className="text-lg font-extrabold text-[#292929]">Verifying Email</h1>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <h1 className="text-xl font-extrabold text-[#292929]">Account Activated</h1>
            <p className="text-sm text-gray-600">{message}</p>
            <Link
              href="/login"
              className="inline-block w-full py-3 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl text-sm transition"
            >
              Proceed to Sign In
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertTriangle className="w-12 h-12 text-red-600 mx-auto" />
            <h1 className="text-xl font-extrabold text-[#292929]">Verification Failed</h1>
            <p className="text-sm text-red-700">{message}</p>
            <Link
              href="/login"
              className="inline-block w-full py-3 bg-[#292929] hover:bg-black text-white font-bold rounded-xl text-sm transition"
            >
              Back to Sign In
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F5F5]" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
