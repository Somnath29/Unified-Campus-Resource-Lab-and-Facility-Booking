import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Shield, ArrowRight, Info } from 'lucide-react';
import { adminApi, setAdminToken } from '../lib/api';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await adminApi.auth.login({ email, password });
      if (res.token) {
        setAdminToken(res.token);
      }
      navigate('/');
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoAdminLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.auth.demoLogin('ADMINISTRATOR');
      if (res.token) {
        setAdminToken(res.token);
      }
      navigate('/');
    } catch (err: any) {
      setErrorMsg(err.message || 'Demo login failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-8 sm:p-10">
        {/* Branding */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#F58220] flex items-center justify-center p-2.5 shadow-md">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-tight">
              <span className="font-extrabold text-lg tracking-tight text-[#292929]">LPU ADMIN</span>
              <span className="bg-[#F58220] text-white text-xs font-black px-1.5 py-0.5 rounded">
                ANALYTICS
              </span>
            </div>
            <div className="text-[10px] font-bold tracking-wider text-gray-500 uppercase leading-none mt-0.5">
              CAMPUS GOVERNANCE & CONTROL
            </div>
          </div>
        </div>

        <h2 className="text-xl font-extrabold text-[#292929] tracking-tight mb-2">
          Administrator Sign In
        </h2>
        <p className="text-xs text-gray-500 mb-6">
          Sign in to access analytics, room management, policy configuration, and audit logs.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Demo Login Button */}
        <div className="mb-6 p-3.5 bg-[#FFF4EA] border border-[#FED7AA] rounded-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-[#F58220] uppercase tracking-wider">
              Evaluator Quick Access
            </span>
            <span className="text-[10px] text-gray-500">1-Click</span>
          </div>
          <button
            type="button"
            onClick={handleDemoAdminLogin}
            disabled={isLoading}
            className="w-full py-2 px-3 bg-white hover:bg-[#F58220] hover:text-white text-gray-800 font-semibold rounded-lg shadow-sm border border-orange-100 transition text-xs flex items-center justify-between"
          >
            <span>⚡ Sign in as Administrator (Rajesh Verma)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Admin Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin.estate@lpu.in"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to Admin Portal</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-2.5 text-xs text-gray-500">
          <Info className="w-4 h-4 shrink-0 text-[#F58220] mt-0.5" />
          <span>Only users with ADMINISTRATOR privileges can access this analytics dashboard.</span>
        </div>
      </div>
    </div>
  );
}

export default Login;
