import React, { useState, useEffect } from 'react';
import {
  Building,
  Plus,
  Wrench,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Search,
  X,
  Edit2,
  QrCode,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { adminApi } from '../lib/api';
import { ResourceDTO, ResourceCategory, ResourceRoomQrDTO } from '@lpu/shared';

export function ResourceManagement() {
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Maintenance toggle modal
  const [maintenanceResource, setMaintenanceResource] = useState<ResourceDTO | null>(null);
  const [maintenanceReason, setMaintenanceReason] = useState('');

  // Room Venue QR modal
  const [roomQrData, setRoomQrData] = useState<ResourceRoomQrDTO | null>(null);
  const [isRoomQrLoading, setIsRoomQrLoading] = useState(false);
  const [isRotatingQr, setIsRotatingQr] = useState(false);

  // Add resource modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ResourceCategory>('CLASSROOM');
  const [newBuilding, setNewBuilding] = useState('CSE Block 34');
  const [newCapacity, setNewCapacity] = useState('40');
  const [newAmenities, setNewAmenities] = useState('Projector, AC, Smart Board');
  const [newRequiresApproval, setNewRequiresApproval] = useState(false);
  const [newHours, setNewHours] = useState('08:00 AM - 08:00 PM');

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.resources.list();
      setResources(res.resources || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintenanceResource) return;
    try {
      const nextState = !maintenanceResource.isUnderMaintenance;
      await adminApi.resources.update(maintenanceResource.id, {
        isUnderMaintenance: nextState,
        maintenanceReason: nextState ? maintenanceReason || 'Routine servicing' : null,
      });
      setMaintenanceResource(null);
      setMaintenanceReason('');
      fetchResources();
    } catch (err: any) {
      alert(err.message || 'Failed to update resource maintenance state.');
    }
  };

  const handleDeleteResource = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) {
      try {
        await adminApi.resources.delete(id);
        fetchResources();
      } catch (err: any) {
        alert(err.message || 'Failed to delete resource.');
      }
    }
  };

  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amenitiesArr = newAmenities.split(',').map((s) => s.trim()).filter(Boolean);
      await adminApi.resources.create({
        code: newCode,
        name: newName,
        category: newCategory,
        building: newBuilding,
        capacity: Number(newCapacity),
        amenities: amenitiesArr,
        requiresApproval: newRequiresApproval,
        operatingHours: newHours,
      });
      setIsAddModalOpen(false);
      setNewCode('');
      setNewName('');
      fetchResources();
    } catch (err: any) {
      alert(err.message || 'Failed to create resource.');
    }
  };

  const handleOpenRoomQr = async (resourceId: string) => {
    setIsRoomQrLoading(true);
    try {
      const res = await adminApi.resources.getRoomQr(resourceId);
      setRoomQrData(res.roomQr);
    } catch (err: any) {
      alert(err.message || 'Failed to load room QR code.');
    } finally {
      setIsRoomQrLoading(false);
    }
  };

  const handleRotateRoomQr = async () => {
    if (!roomQrData) return;
    if (
      !confirm(
        `Rotate venue secret for ${roomQrData.resourceName}? All previously printed QR posters for this room will immediately become invalid.`
      )
    ) {
      return;
    }
    setIsRotatingQr(true);
    try {
      const res = await adminApi.resources.rotateRoomQr(roomQrData.resourceId);
      setRoomQrData(res.roomQr);
      alert(res.message);
    } catch (err: any) {
      alert(err.message || 'Failed to rotate room QR secret.');
    } finally {
      setIsRotatingQr(false);
    }
  };

  const handlePrintRoomQr = () => {
    window.print();
  };

  const filtered = resources.filter(
    (r) =>
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.building.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
            Campus Facilities & Asset Governance
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure classrooms, laboratories, equipment, and toggle maintenance downtime.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add Facility</span>
        </button>
      </div>

      {/* Search & Stats Filter */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search facility name, code, or building..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
          />
        </div>

        <div className="flex items-center gap-4 text-xs font-bold text-gray-600">
          <span>Total: {resources.length} Facilities</span>
          <span className="text-emerald-600">
            Active: {resources.filter((r) => !r.isUnderMaintenance).length}
          </span>
          <span className="text-red-600">
            Maintenance: {resources.filter((r) => r.isUnderMaintenance).length}
          </span>
        </div>
      </div>

      {/* Facilities Table */}
      {isLoading ? (
        <div className="p-16 text-center">
          <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-xs text-gray-400">Loading resources...</div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAFAFA] border-b border-gray-100 text-gray-400 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">Facility Code & Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Building / Location</th>
                  <th className="py-3 px-4">Capacity</th>
                  <th className="py-3 px-4">Approval Rule</th>
                  <th className="py-3 px-4">Operational Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <td className="py-3.5 px-4 font-bold text-gray-900">
                      <div>{r.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{r.code}</div>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 font-medium">
                      <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold">
                        {r.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600">{r.building}</td>
                    <td className="py-3.5 px-4 font-bold text-gray-800">{r.capacity} seats</td>
                    <td className="py-3.5 px-4">
                      {r.requiresApproval ? (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded">
                          Requires Approver
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                          Instant Auto-Approve
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {r.isUnderMaintenance ? (
                        <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full flex items-center gap-1 w-fit">
                          <Wrench className="w-3 h-3 text-red-600" />
                          <span>Under Maintenance</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1 w-fit">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Available</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Room Venue QR Button */}
                        <button
                          onClick={() => handleOpenRoomQr(r.id)}
                          disabled={isRoomQrLoading}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg border border-blue-200 bg-blue-50 text-[#1976B9] hover:bg-blue-100 transition flex items-center gap-1"
                          title="View & Print Room Check-In QR"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Room QR</span>
                        </button>

                        {/* Toggle Maintenance Button */}
                        <button
                          onClick={() => {
                            setMaintenanceResource(r);
                            setMaintenanceReason(r.maintenanceReason || '');
                          }}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                            r.isUnderMaintenance
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                          }`}
                        >
                          {r.isUnderMaintenance ? 'End Maintenance' : 'Block (Maintenance)'}
                        </button>

                        <button
                          onClick={() => handleDeleteResource(r.id, r.name)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title="Delete facility"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Maintenance Toggle Modal */}
      {maintenanceResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100">
            <h3 className="text-base font-extrabold text-gray-900 mb-1">
              {maintenanceResource.isUnderMaintenance
                ? 'Restore Facility to Service'
                : 'Put Facility Under Maintenance Downtime'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Resource: <span className="font-bold text-gray-800">{maintenanceResource.name}</span>.
              When under maintenance, the reservation engine actively blocks all incoming bookings.
            </p>

            <form onSubmit={handleToggleMaintenance} className="space-y-4">
              {!maintenanceResource.isUnderMaintenance && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Reason for Maintenance / Upkeep *
                  </label>
                  <input
                    type="text"
                    required
                    value={maintenanceReason}
                    onChange={(e) => setMaintenanceReason(e.target.value)}
                    placeholder="e.g. Projector replacement, Annual electrical audit, AC repair..."
                    className="w-full p-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMaintenanceResource(null)}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow"
                >
                  {maintenanceResource.isUnderMaintenance
                    ? 'Reopen Facility'
                    : 'Confirm Maintenance Block'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Resource Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <h3 className="text-base font-extrabold text-gray-900">Add New Campus Facility</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddResource} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Facility Code *</label>
                  <input
                    type="text"
                    required
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="e.g. CSE-CR-305"
                    className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Category *</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ResourceCategory)}
                    className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                  >
                    <option value="CLASSROOM">Classroom</option>
                    <option value="LAB">Laboratory</option>
                    <option value="SEMINAR_HALL">Seminar Hall</option>
                    <option value="MEETING_ROOM">Meeting Room</option>
                    <option value="SPORTS">Sports Facility</option>
                    <option value="EQUIPMENT">Equipment</option>
                    <option value="VEHICLE">Vehicle</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Facility Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Smart IoT Research Lab"
                  className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Building *</label>
                  <input
                    type="text"
                    required
                    value={newBuilding}
                    onChange={(e) => setNewBuilding(e.target.value)}
                    placeholder="CSE Block 34"
                    className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Capacity *</label>
                  <input
                    type="number"
                    required
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(e.target.value)}
                    placeholder="40"
                    className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Amenities (comma-separated)
                </label>
                <input
                  type="text"
                  value={newAmenities}
                  onChange={(e) => setNewAmenities(e.target.value)}
                  placeholder="Projector, AC, Smart Board, Gigabit LAN"
                  className="w-full p-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="reqApp"
                  checked={newRequiresApproval}
                  onChange={(e) => setNewRequiresApproval(e.target.checked)}
                  className="w-4 h-4 accent-[#F58220] rounded"
                />
                <label htmlFor="reqApp" className="text-xs text-gray-700 font-semibold cursor-pointer">
                  Requires Department Approver review before confirmation
                </label>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow"
                >
                  Save Facility
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Room Venue QR Modal */}
      {roomQrData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 print:hidden">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-[#F58220]" />
                <h3 className="text-base font-extrabold text-gray-900">
                  Printable Venue Check-In QR
                </h3>
              </div>
              <button
                onClick={() => setRoomQrData(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Print-friendly poster card */}
            <div className="p-6 bg-[#F5F5F5] print:bg-white rounded-2xl border-2 border-dashed border-gray-300 text-center space-y-3">
              <div className="text-xs font-black uppercase tracking-widest text-[#F58220]">
                LPU Campus Check-In Point
              </div>
              <h4 className="text-lg font-extrabold text-[#292929]">{roomQrData.resourceName}</h4>
              <p className="text-xs text-gray-600 font-medium">
                {roomQrData.resourceCode} • {roomQrData.building}
                {roomQrData.floor ? ` • ${roomQrData.floor}` : ''}
              </p>

              <div className="inline-block p-3 bg-white rounded-2xl shadow-sm border border-gray-200">
                <QRCodeSVG value={roomQrData.qrPayload} size={200} level="H" includeMargin />
              </div>

              <div className="text-[11px] text-gray-500">
                Scan this room QR inside CheckInModal to verify physical presence.
                <div className="font-mono mt-1 text-gray-400">
                  Secret Version: v{roomQrData.secretVersion}
                  {roomQrData.rotatedAt
                    ? ` • Rotated ${new Date(roomQrData.rotatedAt).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 print:hidden">
              <strong>Security Notice:</strong> Rotating this room&apos;s secret immediately invalidates all previously printed QR posters for this facility.
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={handlePrintRoomQr}
                className="flex-1 py-2.5 bg-[#292929] hover:bg-black text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" />
                <span>Print Room QR</span>
              </button>
              <button
                type="button"
                onClick={handleRotateRoomQr}
                disabled={isRotatingQr}
                className="flex-1 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRotatingQr ? 'animate-spin' : ''}`} />
                <span>{isRotatingQr ? 'Rotating...' : 'Rotate Secret'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

