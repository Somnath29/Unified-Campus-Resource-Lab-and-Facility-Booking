import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Building,
  Users,
  ShieldCheck,
  History,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const navItems = [
    { name: 'Analytics & Insights', path: '/', icon: BarChart3 },
    { name: 'Facility Management', path: '/resources', icon: Building },
    { name: 'User Management & Roles', path: '/users', icon: Users },
    { name: 'Department Policies', path: '/policies', icon: ShieldCheck },
    { name: 'System Audit Trail', path: '/audit', icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      {/* Left Sidebar */}
      <aside className="w-64 bg-[#161922] text-white flex flex-col justify-between shrink-0 h-screen sticky top-0 border-r border-[#262B38] z-30 select-none">
        <div>
          {/* LPU Branding */}
          <div className="p-5 border-b border-[#232734]">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#F58220] flex items-center justify-center p-2 shadow-md">
                <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white">
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
                  <span className="font-extrabold text-sm tracking-tight text-white">LPU ADMIN</span>
                  <span className="bg-[#F58220] text-black text-[9px] font-black px-1 rounded-sm">
                    ANALYTICS
                  </span>
                </div>
                <div className="text-[10px] font-bold tracking-wider text-gray-300 uppercase leading-none mt-0.5">
                  FACILITIES & ASSETS
                </div>
                <div className="text-[8px] tracking-[0.2em] text-[#F58220] font-medium uppercase mt-0.5">
                  CAMPUS GOVERNANCE
                </div>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1.5 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-xs transition ${
                    isActive
                      ? 'bg-[#F58220] text-white shadow-sm font-bold'
                      : 'text-gray-300 hover:text-white hover:bg-[#202430]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}

            {/* Link back to Main Student/Faculty App */}
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-xs text-[#1976B9] bg-blue-900/20 border border-blue-500/20 hover:bg-blue-900/30 transition mt-4"
            >
              <div className="flex items-center gap-2">
                <span>Open Student App</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </nav>
        </div>

        {/* Bottom Administrator Card */}
        <div className="p-4 border-t border-[#232734] space-y-2">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#1D212C] border border-[#2B3040]">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80"
              alt="Rajesh Verma"
              className="w-8 h-8 rounded-full object-cover border border-[#F58220]"
            />
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white truncate">Rajesh Verma</div>
              <div className="text-[10px] text-gray-400 truncate">Campus Administrator</div>
            </div>
          </div>
          <div className="text-[10px] text-gray-500 text-center">
            PostgreSQL • Prisma • Node.js API
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 sticky top-0 z-20 px-8 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-sm text-[#292929]">
              Enterprise Campus Intelligence
            </span>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Database Connected</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="http://localhost:3000"
              className="text-xs font-bold text-[#F58220] hover:underline flex items-center gap-1"
            >
              <span>Switch to Next.js App (:3000)</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}

