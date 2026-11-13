import React, { useState, useEffect } from 'react';
import { Users, Search, Shield, CheckCircle2, UserCheck, AlertCircle } from 'lucide-react';
import { adminApi } from '../lib/api';
import { UserRole } from '@lpu/shared';

export function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.users.list();
      setUsers(res.users || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole, userName: string) => {
    try {
      await adminApi.users.updateRole(userId, newRole);
      setSuccessToast(`Role for ${userName} successfully updated to ${newRole}.`);
      setTimeout(() => setSuccessToast(null), 4000);
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to update user role.');
    }
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.regNo && u.regNo.toLowerCase().includes(searchTerm.toLowerCase())) ||
      u.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
          User Directory & Role Governance
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Assign role-based access control (Student, Faculty, Approver, Administrator) across campus.
        </p>
      </div>

      {successToast && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Search Header */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search student or faculty name, email, UID..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
          />
        </div>

        <div className="text-xs font-bold text-gray-500">
          Total Registered Users: {users.length}
        </div>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="p-16 text-center">
          <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-xs text-gray-400">Loading directory...</div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAFAFA] border-b border-gray-100 text-gray-400 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">Member Name & Email</th>
                  <th className="py-3 px-4">UID / Reg No.</th>
                  <th className="py-3 px-4">School / Department</th>
                  <th className="py-3 px-4">Current Role</th>
                  <th className="py-3 px-4">Modify Access Privilege</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition">
                    <td className="py-3.5 px-4 font-bold text-gray-900">
                      <div>{u.name}</div>
                      <div className="text-[10px] text-gray-400 font-normal">{u.email}</div>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 font-mono">{u.regNo || 'N/A'}</td>
                    <td className="py-3.5 px-4 text-gray-600">{u.department}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                          u.role === 'ADMINISTRATOR'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'DEPARTMENT_APPROVER'
                            ? 'bg-blue-100 text-blue-800'
                            : u.role === 'FACULTY'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-orange-100 text-[#F58220]'
                        }`}
                      >
                        {u.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChange(u.id, e.target.value as UserRole, u.name)
                        }
                        className="p-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 focus:outline-none focus:border-[#F58220]"
                      >
                        <option value="STUDENT">Student</option>
                        <option value="FACULTY">Faculty</option>
                        <option value="DEPARTMENT_APPROVER">Department Approver</option>
                        <option value="ADMINISTRATOR">Administrator</option>
                      </select>
                    </td>
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

