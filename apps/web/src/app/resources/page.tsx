'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Grid,
  List,
  Search,
  Filter,
  Users,
  MapPin,
  Clock,
  Heart,
  ChevronRight,
  Lightbulb,
  Building,
  Laptop,
  Tv,
  Car,
  Activity,
  Layers,
  Sparkles,
  Info,
  Calendar,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { BookingModal } from '@/components/booking/BookingModal';
import { api } from '@/lib/api';
import { ResourceDTO, ResourceCategory } from '@lpu/shared';

function ResourcesContent() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Filters State (Matching Screenshot 3)
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [timeSlot, setTimeSlot] = useState('ALL');
  const [selectedBuilding, setSelectedBuilding] = useState('ALL');
  const [capacityFilter, setCapacityFilter] = useState('ALL');
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [availabilityMode, setAvailabilityMode] = useState<'ALL' | 'NOW' | 'ADVANCE'>('ALL');
  const [searchKeyword, setSearchKeyword] = useState(initialSearch);
  const [sortBy, setSortBy] = useState<'relevance' | 'capacity' | 'name'>('relevance');

  // Modal State
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedResourceForBooking, setSelectedResourceForBooking] = useState<ResourceDTO | null>(null);
  const [detailModalResource, setDetailModalResource] = useState<ResourceDTO | null>(null);

  // Favorites
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    setIsLoading(true);
    try {
      const res = await api.resources.list();
      setResources(res.resources || []);
    } catch (err) {
      console.error('Failed to load resources:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity]
    );
  };

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleClearFilters = () => {
    setSelectedCategory('ALL');
    setTimeSlot('ALL');
    setSelectedBuilding('ALL');
    setCapacityFilter('ALL');
    setSelectedAmenities([]);
    setAvailabilityMode('ALL');
    setSearchKeyword('');
  };

  // Filter & Sort Logic
  const filteredResources = resources.filter((r) => {
    if (selectedCategory !== 'ALL' && r.category !== selectedCategory) return false;
    if (selectedBuilding !== 'ALL' && !r.building.toLowerCase().includes(selectedBuilding.toLowerCase()))
      return false;

    if (capacityFilter === '1-20' && (r.capacity < 1 || r.capacity > 20)) return false;
    if (capacityFilter === '21-50' && (r.capacity < 21 || r.capacity > 50)) return false;
    if (capacityFilter === '51-100' && (r.capacity < 51 || r.capacity > 100)) return false;
    if (capacityFilter === '100+' && r.capacity <= 100) return false;

    if (selectedAmenities.length > 0) {
      const hasAll = selectedAmenities.every((amenity) =>
        r.amenities.some((a) => a.toLowerCase().includes(amenity.toLowerCase()))
      );
      if (!hasAll) return false;
    }

    if (availabilityMode === 'NOW' && !r.isAvailableNow) return false;

    if (searchKeyword.trim()) {
      const q = searchKeyword.toLowerCase();
      const match =
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.building.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  // Sort
  const sortedResources = [...filteredResources].sort((a, b) => {
    if (sortBy === 'capacity') return b.capacity - a.capacity;
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return 0; // relevance
  });

  const categories = [
    { label: 'All', value: 'ALL', icon: Layers },
    { label: 'Classrooms', value: 'CLASSROOM', icon: Building },
    { label: 'Labs', value: 'LAB', icon: Laptop },
    { label: 'Seminar Halls', value: 'SEMINAR_HALL', icon: Tv },
    { label: 'Meeting Rooms', value: 'MEETING_ROOM', icon: Users },
    { label: 'Sports', value: 'SPORTS', icon: Activity },
    { label: 'Equipment', value: 'EQUIPMENT', icon: Sparkles },
    { label: 'Vehicles', value: 'VEHICLE', icon: Car },
  ];

  const amenityOptions = [
    'Projector',
    'AC',
    'Smart Board',
    'Whiteboard',
    'Computers',
    'Lab Software',
    'Audio System',
    'Sports Equipment',
  ];

  const handleOpenBooking = (res: ResourceDTO) => {
    setSelectedResourceForBooking(res);
    setIsBookingModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Breadcrumb & Title */}
          <div>
            <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <Link href="/" className="hover:text-gray-600">
                Dashboard
              </Link>
              <span>›</span>
              <span className="text-[#F58220] font-semibold">Find Resources</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-extrabold text-[#292929] tracking-tight">
              Find Campus Resources
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Discover and book classrooms, labs, seminar halls, meeting rooms, sports facilities,
              equipment and more.
            </p>
          </div>

          {/* Smart Booking Suggestion Banner (Matching Screenshot 3) */}
          <div className="p-4 bg-[#FFF4EA] border border-[#FED7AA] rounded-2xl flex items-center gap-3 text-xs text-[#292929]">
            <div className="w-8 h-8 rounded-xl bg-[#F58220] text-white flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-[#F58220]">Smart Booking Suggestion:</span> Use
              filters to find the best-fit rooms based on your group size and requirements. Classrooms
              and Seminar Halls are auto-scheduled around academic timetables.
            </div>
          </div>

          {/* Discovery Layout: Filters Sidebar + Catalog Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT FILTERS PANEL (Matching Screenshot 3) (3.5 Cols) */}
            <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <span className="text-sm font-extrabold text-gray-900">Filters</span>
                <button
                  onClick={handleClearFilters}
                  className="text-xs text-[#F58220] hover:text-[#E06D0C] font-bold"
                >
                  Clear All
                </button>
              </div>

              {/* Resource Category Buttons (Grid of 2) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">
                  Resource Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((c) => {
                    const Icon = c.icon;
                    const isSelected = selectedCategory === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setSelectedCategory(c.value)}
                        className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
                          isSelected
                            ? 'bg-[#FFF4EA] border-[#F58220] text-[#F58220] font-bold shadow-sm'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-[#F58220]' : 'text-gray-400'}`} />
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                />
              </div>

              {/* Time Slot */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Time Slot</label>
                <select
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  <option value="ALL">Select time slot</option>
                  <option value="MORNING">08:00 AM - 12:00 PM (Morning)</option>
                  <option value="AFTERNOON">12:00 PM - 04:00 PM (Afternoon)</option>
                  <option value="EVENING">04:00 PM - 08:00 PM (Evening)</option>
                </select>
              </div>

              {/* Building / Location */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Building / Location
                </label>
                <select
                  value={selectedBuilding}
                  onChange={(e) => setSelectedBuilding(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  <option value="ALL">All Buildings</option>
                  <option value="CSE Block">CSE Block (Block 33 & 34)</option>
                  <option value="Main Academic">Main Academic Block 32</option>
                  <option value="Admin Block">Admin Block 30</option>
                  <option value="Sports Complex">Sports Complex Block 19</option>
                  <option value="Student Activity">Student Activity Center (SAC)</option>
                  <option value="Transport">Transport Office Gate 1</option>
                </select>
              </div>

              {/* Capacity */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Capacity (People)
                </label>
                <select
                  value={capacityFilter}
                  onChange={(e) => setCapacityFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  <option value="ALL">Any Capacity</option>
                  <option value="1-20">1 - 20 People</option>
                  <option value="21-50">21 - 50 People</option>
                  <option value="51-100">51 - 100 People</option>
                  <option value="100+">100+ People (Auditoriums/Halls)</option>
                </select>
              </div>

              {/* Equipment / Facilities Checkboxes */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">
                  Equipment / Facilities
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {amenityOptions.map((amenity) => (
                    <label
                      key={amenity}
                      className="flex items-center gap-2 cursor-pointer select-none text-gray-600 hover:text-gray-900"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAmenities.includes(amenity)}
                        onChange={() => toggleAmenity(amenity)}
                        className="w-3.5 h-3.5 accent-[#F58220] rounded"
                      />
                      <span>{amenity}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Availability Radio */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Availability</label>
                <div className="space-y-1.5 text-xs text-gray-600">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="avail"
                      checked={availabilityMode === 'ALL'}
                      onChange={() => setAvailabilityMode('ALL')}
                      className="accent-[#F58220]"
                    />
                    <span>All</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="avail"
                      checked={availabilityMode === 'NOW'}
                      onChange={() => setAvailabilityMode('NOW')}
                      className="accent-[#F58220]"
                    />
                    <span>Available Now</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="avail"
                      checked={availabilityMode === 'ADVANCE'}
                      onChange={() => setAvailabilityMode('ADVANCE')}
                      className="accent-[#F58220]"
                    />
                    <span>Advance Booking</span>
                  </label>
                </div>
              </div>

              {/* Apply Filters Button */}
              <button
                type="button"
                onClick={() => {}}
                className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition text-xs flex items-center justify-center gap-2"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Apply Filters</span>
              </button>
            </div>

            {/* RIGHT CATALOG (Matching Screenshot 3) (8.5 Cols) */}
            <div className="lg:col-span-8 space-y-4">
              {/* Header: Result Count + View Toggle + Sort */}
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between flex-wrap gap-3">
                <div className="font-extrabold text-sm text-[#292929]">
                  {sortedResources.length} Resources Found
                </div>

                <div className="flex items-center gap-3">
                  {/* Grid / List toggle */}
                  <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        viewMode === 'grid'
                          ? 'bg-[#F58220] text-white shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Grid</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        viewMode === 'list'
                          ? 'bg-[#F58220] text-white shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">List</span>
                    </button>
                  </div>

                  {/* Sort Dropdown */}
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-400">Sort by</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:outline-none"
                    >
                      <option value="relevance">Relevance</option>
                      <option value="capacity">Capacity (High to Low)</option>
                      <option value="name">Name (A-Z)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Resource Cards Grid (3 Columns) */}
              {isLoading ? (
                <div className="p-16 text-center">
                  <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <div className="text-xs text-gray-400">Loading campus catalog...</div>
                </div>
              ) : sortedResources.length === 0 ? (
                <div className="p-16 text-center bg-white rounded-2xl border border-gray-100">
                  <Building className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <div className="text-sm font-bold text-gray-700">No matching resources found</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Try adjusting your category, capacity, or building filters.
                  </div>
                  <button
                    onClick={handleClearFilters}
                    className="mt-4 px-4 py-1.5 bg-[#F58220] text-white text-xs font-bold rounded-xl"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div
                  className={
                    viewMode === 'grid'
                      ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                      : 'space-y-3'
                  }
                >
                  {sortedResources.map((res) => {
                    const isFav = !!favorites[res.id];
                    return (
                      <div
                        key={res.id}
                        className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col justify-between"
                      >
                        {/* Image & Badges */}
                        <div className="relative h-40 w-full bg-gray-200">
                          <img
                            src={res.imageUrl}
                            alt={res.name}
                            className="w-full h-full object-cover"
                          />
                          {/* Category Badge */}
                          <span className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">
                            {res.category.replace('_', ' ')}
                          </span>
                          {/* Favorite Heart */}
                          <button
                            onClick={(e) => toggleFavorite(res.id, e)}
                            className="absolute top-2.5 right-2.5 p-1.5 bg-white/90 backdrop-blur rounded-full text-gray-600 hover:text-red-500 shadow-sm transition"
                          >
                            <Heart
                              className={`w-3.5 h-3.5 ${
                                isFav ? 'fill-red-500 text-red-500' : ''
                              }`}
                            />
                          </button>
                        </div>

                        {/* Card Details */}
                        <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                          <div>
                            <h3 className="font-extrabold text-sm text-[#292929] truncate">
                              {res.name}
                            </h3>
                            <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5 truncate">
                              <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{res.building}</span>
                            </div>

                            {/* Features row */}
                            <div className="flex items-center gap-3 text-[11px] text-gray-600 mt-2">
                              <span className="flex items-center gap-1 font-semibold">
                                <Users className="w-3.5 h-3.5 text-gray-400" />
                                {res.capacity}
                              </span>
                              {res.amenities.slice(0, 2).map((amenity) => (
                                <span
                                  key={amenity}
                                  className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]"
                                >
                                  {amenity}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Availability status badge */}
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-100">
                            <span className="flex items-center gap-1 font-semibold text-emerald-700">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span>Available Today</span>
                            </span>
                            <span className="text-gray-400 text-[10px] truncate max-w-[120px]">
                              {res.operatingHours}
                            </span>
                          </div>

                          {/* Action Buttons: View Details (outline) & Book Now (orange) */}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setDetailModalResource(res)}
                              className="py-1.5 px-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl transition text-center"
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenBooking(res)}
                              className="py-1.5 px-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-1"
                            >
                              <span>Book Now</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Booking Modal */}
      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        preselectedResource={selectedResourceForBooking}
      />

      {/* Resource Detail Modal */}
      {detailModalResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-gray-100">
            <div className="relative h-48 w-full bg-gray-200">
              <img
                src={detailModalResource.imageUrl}
                alt={detailModalResource.name}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => setDetailModalResource(null)}
                className="absolute top-3 right-3 p-2 bg-black/60 text-white hover:bg-black/80 rounded-full transition"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute bottom-3 left-4 bg-[#F58220] text-white text-[11px] font-extrabold px-3 py-1 rounded-full uppercase shadow">
                {detailModalResource.category}
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">
                  {detailModalResource.name}
                </h2>
                <div className="text-xs text-gray-500 font-mono mt-0.5">
                  Code: {detailModalResource.code} • {detailModalResource.department}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-gray-50 p-3.5 rounded-2xl border border-gray-100">
                <div>
                  <span className="text-gray-400 block">Location</span>
                  <span className="font-bold text-gray-800">
                    {detailModalResource.building} ({detailModalResource.floor || 'Ground'})
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block">Capacity</span>
                  <span className="font-bold text-gray-800">
                    {detailModalResource.capacity} Seats
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block">Operating Hours</span>
                  <span className="font-bold text-gray-800">
                    {detailModalResource.operatingHours}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block">Approval Required</span>
                  <span className="font-bold text-gray-800">
                    {detailModalResource.requiresApproval ? 'Yes (Department Head)' : 'No (Instant)'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-gray-700 block mb-1.5">
                  Available Amenities & Equipment
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {detailModalResource.amenities.map((a) => (
                    <span
                      key={a}
                      className="text-xs bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] font-semibold px-2.5 py-1 rounded-xl"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setDetailModalResource(null)}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const r = detailModalResource;
                    setDetailModalResource(null);
                    handleOpenBooking(r);
                  }}
                  className="flex-1 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl text-xs transition shadow"
                >
                  Book This Facility
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ResourcesContent />
    </Suspense>
  );
}
