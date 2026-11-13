import React, { useState, useEffect } from 'react';
import { ShieldCheck, Save, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { adminApi } from '../lib/api';
import { DepartmentPolicyDTO } from '@lpu/shared';

export function PolicyManagement() {
  const [policies, setPolicies] = useState<DepartmentPolicyDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.policies.list();
      setPolicies(res.policies || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePolicy = async (policy: DepartmentPolicyDTO) => {
    try {
      await adminApi.policies.update(policy.id, policy);
      setSavedId(policy.id);
      setTimeout(() => setSavedId(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to update department policy.');
    }
  };

  const handleFieldChange = (id: string, field: keyof DepartmentPolicyDTO, value: any) => {
    setPolicies((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
          Department Booking Policies & Allocation Rules
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Establish reservation limits, automated no-show release timeouts, and faculty endorsement rules.
        </p>
      </div>

      {isLoading ? (
        <div className="p-16 text-center">
          <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-xs text-gray-400">Loading department policies...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {policies.map((p) => (
            <div
              key={p.id}
              className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <h3 className="font-extrabold text-sm text-gray-900">{p.department}</h3>
                  <ShieldCheck className="w-4 h-4 text-[#F58220]" />
                </div>

                <div className="space-y-3 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Max Advance Reservation Window (Days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={p.maxAdvanceDays}
                      onChange={(e) =>
                        handleFieldChange(p.id, 'maxAdvanceDays', Number(e.target.value))
                      }
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#F58220]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Weekly Reservation Quota Per Student (Hours)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={40}
                      value={p.maxBookingHoursPerWeek}
                      onChange={(e) =>
                        handleFieldChange(p.id, 'maxBookingHoursPerWeek', Number(e.target.value))
                      }
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#F58220]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Auto-Release Deadline After No-Show (Minutes)
                    </label>
                    <div className="relative">
                      <Clock className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        min={5}
                        max={60}
                        value={p.autoReleaseMinutes}
                        onChange={(e) =>
                          handleFieldChange(p.id, 'autoReleaseMinutes', Number(e.target.value))
                        }
                        className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-[#F58220]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id={`endorse-${p.id}`}
                      checked={p.requireFacultyEndorsement}
                      onChange={(e) =>
                        handleFieldChange(p.id, 'requireFacultyEndorsement', e.target.checked)
                      }
                      className="w-4 h-4 accent-[#F58220] rounded"
                    />
                    <label
                      htmlFor={`endorse-${p.id}`}
                      className="text-xs text-gray-700 font-semibold cursor-pointer"
                    >
                      Require Faculty In-charge Endorsement
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleUpdatePolicy(p)}
                  className="w-full py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5"
                >
                  {savedId === p.id ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Policy Saved Successfully!</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Update Department Policy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

