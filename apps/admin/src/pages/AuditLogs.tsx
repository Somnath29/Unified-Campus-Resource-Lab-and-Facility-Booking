import React, { useState, useEffect } from 'react';
import { History, Shield, Clock, Search, Filter } from 'lucide-react';
import { adminApi } from '../lib/api';

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.audit.list();
      setLogs(res.logs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      (l.details && l.details.toLowerCase().includes(search.toLowerCase())) ||
      (l.user && l.user.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
          System Audit Trail & Security Logs
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Immutable event log of all reservations, check-ins, automated no-show releases, and policy modifications.
        </p>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, user, or details..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
          />
        </div>
        <div className="text-xs font-bold text-gray-500">
          Showing {filtered.length} Recorded Events
        </div>
      </div>

      {isLoading ? (
        <div className="p-16 text-center">
          <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-xs text-gray-400">Loading audit trail...</div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAFAFA] border-b border-gray-100 text-gray-400 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action Event</th>
                  <th className="py-3 px-4">Initiator / Actor</th>
                  <th className="py-3 px-4">Entity Type</th>
                  <th className="py-3 px-4">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 transition">
                    <td className="py-3 px-4 font-mono text-gray-400 text-[11px] whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          l.action.includes('AUTOMATIC')
                            ? 'bg-red-100 text-red-800'
                            : l.action.includes('APPROVED')
                            ? 'bg-emerald-100 text-emerald-800'
                            : l.action.includes('CHECKIN')
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-gray-800">
                      {l.user ? `${l.user.name} (${l.user.role})` : 'System Daemon'}
                    </td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-[11px]">
                      {l.entityType}
                    </td>
                    <td className="py-3 px-4 text-gray-700">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

