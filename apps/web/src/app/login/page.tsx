'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Users,
  Building,
  Clock,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Info,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@lpu/shared';

export default function LoginPage() {
  const router = useRouter();
  const { login, register, demoLogin } = useAuth();

  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [regNo, setRegNo] = useState('');
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [department, setDepartment] = useState('School of Computer Science & Engineering');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (mode === 'LOGIN') {
        await login(email, password);
      } else {
        await register({
          email,
          password,
          name,
          role,
          regNo,
          department,
        });
      }
      router.push('/');
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemo = async (demoRole: UserRole) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await demoLogin(demoRole);
      router.push('/');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to sign in to demo account.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F5F5F5] select-none">
      {/* Left Column: Campus Hero & Branding (Matching Screenshot 2) */}
      <div className="lg:w-1/2 relative bg-[#1E222D] text-white flex flex-col justify-between p-8 lg:p-14 overflow-hidden">
        {/* Background Campus Photo with Gradient Overlay */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity scale-105"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1200&q=80')`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#12151D] via-[#161922]/90 to-transparent" />

        {/* Top Header */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#F58220] flex items-center justify-center p-2.5 shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white">
              <circle cx="12" cy="12" r="4" fill="currentColor" />
              <path
                d="M12 2V4M12 20V22M4 12H2M22 12H20M5.636 5.636L7.05 7.05M16.95 16.95L18.364 18.364M5.636 18.364L7.05 16.95M16.95 7.05L18.364 5.636"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-tight">
              <span className="font-extrabold text-lg tracking-tight text-white">LOVELY</span>
              <span className="bg-[#F58220] text-black text-xs font-black px-1.5 py-0.5 rounded-sm">LPU</span>
            </div>
            <div className="text-xs font-bold tracking-wider text-gray-200 uppercase leading-none">
              PROFESSIONAL UNIVERSITY
            </div>
            <div className="text-[9px] tracking-[0.25em] text-[#FFA94D] font-medium uppercase mt-0.5">
              LEARN • GROW • BELONG
            </div>
          </div>
        </div>

        {/* Center Content */}
        <div className="relative z-10 my-auto py-12 max-w-lg">
          <div className="inline-block bg-[#F58220]/20 text-[#FFA94D] border border-[#F58220]/30 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-4">
            Unified Resource Portal
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
            <span className="text-[#F58220]">LPU</span> Smart Campus
          </h1>
          <p className="text-xl font-medium text-gray-200 mt-2">
            Your campus. Better connected.
          </p>
          <p className="text-sm text-gray-400 mt-4 leading-relaxed">
            A single platform to discover and book classrooms, labs, seminar halls, meeting rooms,
            sports facilities, equipment and more.
          </p>

          {/* 4 Feature Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-center">
              <Calendar className="w-5 h-5 mx-auto text-[#F58220] mb-1.5" />
              <div className="text-xs font-bold text-gray-200">Easy Booking</div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-center">
              <Users className="w-5 h-5 mx-auto text-[#F58220] mb-1.5" />
              <div className="text-xs font-bold text-gray-200">Better Utilization</div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-center">
              <Building className="w-5 h-5 mx-auto text-[#F58220] mb-1.5" />
              <div className="text-xs font-bold text-gray-200">Diverse Resources</div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-center">
              <Clock className="w-5 h-5 mx-auto text-[#F58220] mb-1.5" />
              <div className="text-xs font-bold text-gray-200">Smoother Life</div>
            </div>
          </div>

          {/* LPU Slogan Card */}
          <div className="mt-8 p-4 rounded-2xl bg-gradient-to-r from-[#F58220]/20 to-transparent border-l-4 border-[#F58220]">
            <div className="text-base font-black tracking-wide text-white">Think BIG. Think Different.</div>
            <div className="text-xs text-gray-300">Empowering 30,000+ students and researchers across 600+ acres.</div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-xs text-gray-400 border-t border-white/10 pt-4 flex items-center justify-between">
          <span>Transforming Education | Empowering Futures</span>
          <span>Academic Year 2026</span>
        </div>
      </div>

      {/* Right Column: Authentication Card (Matching Screenshot 2) */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-14">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-8 sm:p-10">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-extrabold text-[#292929] tracking-tight">
              {mode === 'LOGIN' ? 'Welcome Back' : 'Create Student / Faculty Account'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {mode === 'LOGIN'
                ? 'Sign in to LPU Smart Campus with your university email'
                : 'Join the campus resource and laboratory booking network'}
            </p>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {/* One-Click Fast Role Sign-in (Evaluator Showcase) */}
          <div className="mb-6 p-3.5 bg-[#FFF4EA] border border-[#FED7AA] rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#F58220] uppercase tracking-wider">
                Instant Demo Access
              </span>
              <span className="text-[10px] text-gray-500">1-Click Sign In</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => handleQuickDemo('STUDENT')}
                className="py-1.5 px-2 bg-white hover:bg-[#F58220] hover:text-white text-gray-800 font-semibold rounded-lg shadow-sm border border-orange-100 transition text-left"
              >
                🎓 Student <span className="text-[10px] block font-normal text-gray-400">Ketan (CSE)</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo('FACULTY')}
                className="py-1.5 px-2 bg-white hover:bg-[#F58220] hover:text-white text-gray-800 font-semibold rounded-lg shadow-sm border border-orange-100 transition text-left"
              >
                👨‍🏫 Faculty <span className="text-[10px] block font-normal text-gray-400">Dr. Arvind</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo('DEPARTMENT_APPROVER')}
                className="py-1.5 px-2 bg-white hover:bg-[#F58220] hover:text-white text-gray-800 font-semibold rounded-lg shadow-sm border border-orange-100 transition text-left"
              >
                📋 Approver <span className="text-[10px] block font-normal text-gray-400">Prof. Meenakshi</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo('ADMINISTRATOR')}
                className="py-1.5 px-2 bg-white hover:bg-[#F58220] hover:text-white text-gray-800 font-semibold rounded-lg shadow-sm border border-orange-100 transition text-left"
              >
                ⚡ Admin <span className="text-[10px] block font-normal text-gray-400">Rajesh Verma</span>
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'REGISTER' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ketan Meshram"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as UserRole)}
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    >
                      <option value="STUDENT">Student</option>
                      <option value="FACULTY">Faculty</option>
                      <option value="DEPARTMENT_APPROVER">Approver</option>
                      <option value="ADMINISTRATOR">Administrator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Reg / UID No.</label>
                    <input
                      type="text"
                      value={regNo}
                      onChange={(e) => setRegNo(e.target.value)}
                      placeholder="12204598"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                  </div>
                </div>
              </>
            )}

            {/* University Email */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">University Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="yourname@lpu.in"
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-700">Password</label>
                {mode === 'LOGIN' && (
                  <button
                    type="button"
                    onClick={() => alert('For password reset, please contact LPU IT Helpdesk (Block 30) or use instant demo logins above.')}
                    className="text-xs font-semibold text-[#F58220] hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            {mode === 'LOGIN' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 accent-[#F58220] rounded"
                />
                <label htmlFor="remember" className="text-xs text-gray-600">
                  Remember me
                </label>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{mode === 'LOGIN' ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Switch Mode Button */}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN');
                setErrorMsg(null);
              }}
              className="w-full py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold rounded-xl text-sm transition"
            >
              {mode === 'LOGIN' ? 'Create an Account' : 'Already have an account? Sign In'}
            </button>
          </form>

          {/* Official Email Notice Callout (Matching Screenshot 2) */}
          <div className="mt-6 p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-2.5 text-xs text-gray-500">
            <Info className="w-4 h-4 shrink-0 text-[#F58220] mt-0.5" />
            <span>Use your official LPU university email (@lpu.in) to access verified academic resources.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

