'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Grid,
  List,
  Search,
  Filter,
  Users,
  MapPin,
  Clock,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  Building,
  Laptop,
  Tv,
  Car,
  Activity,
  Layers,
  Sparkles,
  AlertCircle,
  RefreshCw,
  X,
  SlidersHorizontal,
  Calendar as CalendarIcon,
  ShieldAlert,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';

const BookingModal = dynamic(
  () => import('@/components/booking/BookingModal').then((m) => m.BookingModal),
  { ssr: false }
);
const ResourceDetailModal = dynamic(
  () => import('@/components/resource/ResourceDetailModal').then((m) => m.ResourceDetailModal),
  { ssr: false }
);
import { api } from '@/lib/api';
import { ResourceDTO, ResourceListResponse, ResourceCategory } from '@lpu/shared';
import { formatKolkataTimeRange } from '@/lib/timezone';

const CATEGORIES: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'All Categories', value: 'ALL', icon: Layers },
  { label: 'Classrooms', value: 'CLASSROOM', icon: Building },
  { label: 'Labs', value: 'LABORATORY', icon: Laptop },
  { label: 'Seminar Halls', value: 'SEMINAR_HALL', icon: Tv },
  { label: 'Auditoriums', value: 'AUDITORIUM', icon: Users },
  { label: 'Sports', value: 'SPORTS_FACILITY', icon: Activity },
  { label: 'Equipment', value: 'EQUIPMENT', icon: Sparkles },
  { label: 'Meeting Rooms', value: 'MEETING_ROOM', icon: Users },
];

const AMENITY_OPTIONS = [
  'Projector',
  'AC',
  'Smart Board',
  'Whiteboard',
  'WiFi 6',
  'Computers',
  'Audio System',
  'Lab Software',
  'Conference Mic',
];

const BUILDING_OPTIONS = [
  'All Buildings',
  'CSE Block 34',
  'Block 33',
  'Block 32',
  'Block 30',
  'Media Center Block 14',
  'Sports Complex Block 19',
  'Student Activity Center',
];

const SORT_OPTIONS = [
  { label: 'Name (A to Z)', sortBy: 'name', sortOrder: 'asc' },
  { label: 'Name (Z to A)', sortBy: 'name', sortOrder: 'desc' },
  { label: 'Capacity (High to Low)', sortBy: 'capacity', sortOrder: 'desc' },
  { label: 'Capacity (Low to High)', sortBy: 'capacity', sortOrder: 'asc' },
  { label: 'Recently Added', sortBy: 'createdAt', sortOrder: 'desc' },
];

function ResourcesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state extraction
  const urlSearch = searchParams.get('search') || '';
  const urlCategory = searchParams.get('category') || 'ALL';
  const urlBuilding = searchParams.get('building') || 'ALL';
  const urlMinCapacity = searchParams.get('minCapacity') || '';
  const urlMaxCapacity = searchParams.get('maxCapacity') || '';
  const urlAmenities = searchParams.get('amenities')
    ? searchParams.get('amenities')!.split(',').filter(Boolean)
    : [];
  const urlDate = searchParams.get('date') || '';
  const urlStart = searchParams.get('start') || '';
  const urlEnd = searchParams.get('end') || '';
  const urlSortBy = searchParams.get('sortBy') || 'name';
  const urlSortOrder = searchParams.get('sortOrder') || 'asc';
  const urlPage = parseInt(searchParams.get('page') || '1', 10);
  const urlLimit = parseInt(searchParams.get('limit') || '12', 10);

  // Local state for debounced search input
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  // API Data & States
  const [data, setData] = useState<ResourceListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [detailModalResource, setDetailModalResource] = useState<ResourceDTO | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedBookingResource, setSelectedBookingResource] = useState<ResourceDTO | null>(null);
  const [bookingPreselectDate, setBookingPreselectDate] = useState<string | undefined>(undefined);
  const [bookingPreselectStartTime, setBookingPreselectStartTime] = useState<string | undefined>(undefined);
  const [bookingPreselectEndTime, setBookingPreselectEndTime] = useState<string | undefined>(undefined);

  // AbortController ref to cancel stale requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Synchronize URL helper
  const updateQuery = useCallback(
    (updates: Record<string, string | number | null | undefined>, resetPage = true) => {
      const current = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, val]) => {
        if (val === null || val === undefined || val === '' || val === 'ALL') {
          current.delete(key);
        } else {
          current.set(key, String(val));
        }
      });

      if (resetPage) {
        current.delete('page');
      }

      const queryString = current.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  // Synchronize local search input if URL changes externally (e.g. Back/Forward)
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  // Debounce search input and update URL
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== urlSearch) {
        updateQuery({ search: searchInput.trim() }, true);
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [searchInput, urlSearch, updateQuery]);

  // Fetch resources from real API whenever URL query parameters change
  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    // Cancel existing pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const queryParams: Record<string, string | number> = {
        page: urlPage,
        limit: urlLimit,
        sortBy: urlSortBy,
        sortOrder: urlSortOrder,
      };

      if (urlSearch) queryParams.search = urlSearch;
      if (urlCategory !== 'ALL') queryParams.category = urlCategory;
      if (urlBuilding !== 'ALL') queryParams.building = urlBuilding;
      if (urlMinCapacity) queryParams.minCapacity = urlMinCapacity;
      if (urlMaxCapacity) queryParams.maxCapacity = urlMaxCapacity;
      if (urlAmenities.length > 0) queryParams.amenities = urlAmenities.join(',');
      if (urlDate && urlStart && urlEnd) {
        queryParams.date = urlDate;
        queryParams.start = urlStart;
        queryParams.end = urlEnd;
      }

      const result = await api.resources.list(queryParams);
      if (!controller.signal.aborted) {
        setData(result);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        console.error('Failed to load resources:', err);
        setErrorMessage(err.message || 'Unable to connect to the campus resource catalog. Please check your network and retry.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [
    urlPage,
    urlLimit,
    urlSortBy,
    urlSortOrder,
    urlSearch,
    urlCategory,
    urlBuilding,
    urlMinCapacity,
    urlMaxCapacity,
    urlAmenities,
    urlDate,
    urlStart,
    urlEnd,
  ]);

  useEffect(() => {
    fetchResources();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchResources]);

  // Handlers
  const handleClearAllFilters = () => {
    setSearchInput('');
    router.push(pathname, { scroll: false });
  };

  const handleCategorySelect = (catValue: string) => {
    updateQuery({ category: catValue === urlCategory ? 'ALL' : catValue }, true);
  };

  const handleBuildingSelect = (building: string) => {
    updateQuery({ building: building === 'All Buildings' ? 'ALL' : building }, true);
  };

  const handleAmenityToggle = (amenity: string) => {
    const updated = urlAmenities.includes(amenity)
      ? urlAmenities.filter((a) => a !== amenity)
      : [...urlAmenities, amenity];
    updateQuery({ amenities: updated.length > 0 ? updated.join(',') : null }, true);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = SORT_OPTIONS[parseInt(e.target.value, 10)] || SORT_OPTIONS[0];
    updateQuery({ sortBy: selected.sortBy, sortOrder: selected.sortOrder }, false);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || (data && newPage > data.pagination.totalPages)) return;
    updateQuery({ page: newPage }, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenBooking = (
    res: ResourceDTO,
    date?: string,
    startTime?: string,
    endTime?: string
  ) => {
    setSelectedBookingResource(res);
    setBookingPreselectDate(date);
    setBookingPreselectStartTime(startTime);
    setBookingPreselectEndTime(endTime);
    setIsBookingModalOpen(true);
  };

  // Active filters count
  const activeFiltersCount =
    (urlCategory !== 'ALL' ? 1 : 0) +
    (urlBuilding !== 'ALL' ? 1 : 0) +
    (urlMinCapacity ? 1 : 0) +
    (urlMaxCapacity ? 1 : 0) +
    urlAmenities.length +
    (urlDate && urlStart && urlEnd ? 1 : 0);

  const selectedSortIndex = SORT_OPTIONS.findIndex(
    (s) => s.sortBy === urlSortBy && s.sortOrder === urlSortOrder
  );

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col lg:flex-row">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Breadcrumbs & Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-600 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-900">
                  Dashboard
                </Link>
                <span>›</span>
                <span className="text-[#B45309] font-semibold">Find Resources</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#292929] tracking-tight">
                Find Campus Resources
              </h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
                Discover and reserve classrooms, laboratories, seminar halls, sports facilities, and equipment.
              </p>
            </div>

            {/* Mobile Filter Toggle */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
                className="lg:hidden px-3.5 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 shadow-sm flex items-center gap-2 hover:bg-gray-50"
                aria-expanded={isMobileFilterOpen}
                aria-controls="filters-panel"
              >
                <SlidersHorizontal className="w-4 h-4 text-[#F58220]" />
                <span>Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="w-5 h-5 bg-[#F58220] text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Smart Tip Banner */}
          <div className="p-4 bg-[#FFF4EA] border border-[#FED7AA] rounded-2xl flex items-center gap-3 text-xs text-[#292929]">
            <div className="w-8 h-8 rounded-xl bg-[#C2410C] text-white flex items-center justify-center shrink-0 shadow-sm">
              <Lightbulb className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-[#B45309]">Real-Time Scheduling:</span> Resources
              are synchronized against official university timetables and existing reservations.
              Choose a specific date and time to filter rooms by live availability.
            </div>
          </div>

          {/* Active Filter Chips Bar */}
          {activeFiltersCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
              <span className="font-bold text-gray-500">Active Filters:</span>
              {urlCategory !== 'ALL' && (
                <span className="px-2.5 py-1 bg-[#FFF4EA] border border-[#FED7AA] text-[#F58220] font-semibold rounded-lg flex items-center gap-1.5">
                  Category: {urlCategory.replace('_', ' ')}
                  <button
                    onClick={() => updateQuery({ category: null })}
                    aria-label="Remove category filter"
                    className="hover:text-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {urlBuilding !== 'ALL' && (
                <span className="px-2.5 py-1 bg-gray-100 text-gray-700 font-semibold rounded-lg flex items-center gap-1.5">
                  Building: {urlBuilding}
                  <button
                    onClick={() => updateQuery({ building: null })}
                    aria-label="Remove building filter"
                    className="hover:text-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {(urlMinCapacity || urlMaxCapacity) && (
                <span className="px-2.5 py-1 bg-gray-100 text-gray-700 font-semibold rounded-lg flex items-center gap-1.5">
                  Capacity: {urlMinCapacity || '0'} - {urlMaxCapacity || '∞'}
                  <button
                    onClick={() => updateQuery({ minCapacity: null, maxCapacity: null })}
                    aria-label="Remove capacity filter"
                    className="hover:text-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {urlAmenities.map((amenity) => (
                <span
                  key={amenity}
                  className="px-2.5 py-1 bg-gray-100 text-gray-700 font-semibold rounded-lg flex items-center gap-1.5"
                >
                  {amenity}
                  <button
                    onClick={() => handleAmenityToggle(amenity)}
                    aria-label={`Remove amenity ${amenity}`}
                    className="hover:text-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {urlDate && urlStart && urlEnd && (
                <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold rounded-lg flex items-center gap-1.5">
                  Available: {urlDate} ({urlStart} - {urlEnd})
                  <button
                    onClick={() => updateQuery({ date: null, start: null, end: null })}
                    aria-label="Remove availability filter"
                    className="hover:text-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="ml-auto text-xs text-[#F58220] hover:text-[#E06D0C] font-bold"
              >
                Reset All
              </button>
            </div>
          )}

          {/* Main Layout Grid: Filters Sidebar + Catalog */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Filters Sidebar */}
            <div
              id="filters-panel"
              className={`lg:col-span-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-5 ${
                isMobileFilterOpen ? 'block' : 'hidden lg:block'
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-[#F58220]" />
                  <span className="text-sm font-extrabold text-gray-900">Filters</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="text-xs text-[#B45309] hover:text-[#92400E] font-bold"
                >
                  Clear All
                </button>
              </div>

              {/* Keyword Search Input */}
              <div>
                <label htmlFor="search-input" className="block text-xs font-bold text-gray-700 mb-1.5">
                  Search by Keyword
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    id="search-input"
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search name, code, block..."
                    className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput('')}
                      aria-label="Clear search input"
                      className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Resource Categories */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">Resource Category</label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    const isSelected = urlCategory === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => handleCategorySelect(c.value)}
                        className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition text-left ${
                          isSelected
                            ? 'bg-[#FFF4EA] border-[#F58220] text-[#B45309] font-bold shadow-sm'
                            : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#B45309]' : 'text-gray-500'}`} />
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Building Selection */}
              <div>
                <label htmlFor="building-select" className="block text-xs font-bold text-gray-700 mb-1.5">
                  Building / Location
                </label>
                <select
                  id="building-select"
                  value={urlBuilding}
                  onChange={(e) => handleBuildingSelect(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  {BUILDING_OPTIONS.map((b) => (
                    <option key={b} value={b === 'All Buildings' ? 'ALL' : b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              {/* Capacity Range */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Capacity Range (People)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="number"
                      min="1"
                      placeholder="Min"
                      value={urlMinCapacity}
                      onChange={(e) => updateQuery({ minCapacity: e.target.value || null })}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      min="1"
                      placeholder="Max"
                      value={urlMaxCapacity}
                      onChange={(e) => updateQuery({ maxCapacity: e.target.value || null })}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                  </div>
                </div>
              </div>

              {/* Date & Time Slot Availability Filter */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                <label className="block text-xs font-bold text-gray-800">
                  Filter by Time Availability
                </label>
                <input
                  type="date"
                  aria-label="Availability date"
                  value={urlDate}
                  onChange={(e) => updateQuery({ date: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    aria-label="Availability start time"
                    value={urlStart}
                    onChange={(e) => updateQuery({ start: e.target.value || null })}
                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                  />
                  <input
                    type="time"
                    aria-label="Availability end time"
                    value={urlEnd}
                    onChange={(e) => updateQuery({ end: e.target.value || null })}
                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                  />
                </div>
                {urlDate && (!urlStart || !urlEnd) && (
                  <p className="text-[11px] text-amber-600">Please provide both start and end times.</p>
                )}
              </div>

              {/* Amenities Checkboxes */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">
                  Equipped Amenities (AND matching)
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {AMENITY_OPTIONS.map((amenity) => (
                    <label
                      key={amenity}
                      className="flex items-center gap-2 cursor-pointer select-none text-gray-600 hover:text-gray-900"
                    >
                      <input
                        type="checkbox"
                        checked={urlAmenities.includes(amenity)}
                        onChange={() => handleAmenityToggle(amenity)}
                        className="w-3.5 h-3.5 accent-[#F58220] rounded"
                      />
                      <span className="truncate">{amenity}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Catalog Content Area */}
            <div className="lg:col-span-8 space-y-4">
              {/* Header: Result Count + View Mode Toggle + Sort Dropdown */}
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between flex-wrap gap-3">
                <div className="font-extrabold text-sm text-[#292929]">
                  {data ? `${data.pagination.total} Resources Found` : 'Loading resources...'}
                </div>

                <div className="flex items-center gap-3">
                  {/* Grid / List Toggle */}
                  <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200" role="group" aria-label="View format">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      aria-pressed={viewMode === 'grid'}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        viewMode === 'grid'
                          ? 'bg-[#C2410C] text-white shadow-sm'
                          : 'text-gray-700 hover:text-gray-900'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      aria-pressed={viewMode === 'list'}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        viewMode === 'list'
                          ? 'bg-[#C2410C] text-white shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">List</span>
                    </button>
                  </div>

                  {/* Sort Selector */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-gray-600 hidden sm:inline">Sort:</span>
                    <select
                      value={selectedSortIndex !== -1 ? selectedSortIndex : 0}
                      onChange={handleSortChange}
                      aria-label="Sort resources"
                      className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:outline-none"
                    >
                      {SORT_OPTIONS.map((opt, idx) => (
                        <option key={opt.label} value={idx}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Error State with Retry Button */}
              {errorMessage && (
                <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                  <div className="text-sm font-bold text-red-800">Error Loading Resources</div>
                  <p className="text-xs text-red-600 max-w-md mx-auto">{errorMessage}</p>
                  <button
                    type="button"
                    onClick={fetchResources}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-sm inline-flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Request</span>
                  </button>
                </div>
              )}

              {/* Loading Skeletons */}
              {isLoading && !errorMessage && (
                <div
                  aria-busy="true"
                  className={
                    viewMode === 'grid'
                      ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                      : 'space-y-3'
                  }
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-pulse p-4 space-y-3"
                    >
                      <div className="h-40 bg-gray-200 rounded-xl w-full" />
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                      <div className="h-8 bg-gray-100 rounded w-full mt-4" />
                    </div>
                  ))}
                </div>
              )}

              {/* Empty States */}
              {!isLoading && !errorMessage && data && data.resources.length === 0 && (
                <div className="p-12 text-center bg-white rounded-2xl border border-gray-100 space-y-3 shadow-sm">
                  <Building className="w-12 h-12 text-gray-300 mx-auto" />
                  <h3 className="text-base font-extrabold text-gray-800">
                    {urlSearch
                      ? `No resources matching "${urlSearch}"`
                      : activeFiltersCount > 0
                      ? 'No resources match the selected filters'
                      : 'No campus resources currently available'}
                  </h3>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    Try broadening your search term, clearing capacity bounds, or resetting filters.
                  </p>
                  {activeFiltersCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllFilters}
                      className="mt-2 px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition"
                    >
                      Clear All Filters
                    </button>
                  )}
                </div>
              )}

              {/* Resource Cards (Grid or List View) */}
              {!isLoading && !errorMessage && data && data.resources.length > 0 && (
                <div
                  className={
                    viewMode === 'grid'
                      ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                      : 'space-y-3'
                  }
                >
                  {data.resources.map((res) => {
                    if (viewMode === 'list') {
                      return (
                        <div
                          key={res.id}
                          className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                              <img
                                src={res.imageUrl || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=300&q=80'}
                                alt={res.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-extrabold text-sm text-[#292929]">{res.name}</h3>
                                <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                                  {res.category.replace('_', ' ')}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                  {res.building}
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1 font-semibold text-gray-700">
                                  <Users className="w-3.5 h-3.5 text-gray-400" />
                                  {res.capacity}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                            <button
                              type="button"
                              onClick={() => setDetailModalResource(res)}
                              className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenBooking(res)}
                              className="px-3.5 py-1.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1"
                            >
                              <span>Reserve</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Grid Card
                    return (
                      <div
                        key={res.id}
                        className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col justify-between"
                      >
                        {/* Image & Badges */}
                        <div className="relative h-44 w-full bg-gray-900">
                          <img
                            src={res.imageUrl || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80'}
                            alt={res.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

                          {/* Category Badge */}
                          <span className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                            {res.category.replace('_', ' ')}
                          </span>

                          {/* Maintenance Badge if applicable */}
                          {res.isUnderMaintenance && (
                            <span className="absolute top-2.5 right-2.5 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow">
                              <ShieldAlert className="w-3 h-3" />
                              Maintenance
                            </span>
                          )}

                          {/* Room Code */}
                          <span className="absolute bottom-2 left-2.5 text-white/90 font-mono text-[11px] font-bold">
                            {res.code}
                          </span>
                        </div>

                        {/* Card Details */}
                        <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                          <div>
                            <h3 className="font-extrabold text-sm text-[#292929] truncate" title={res.name}>
                              {res.name}
                            </h3>
                            <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5 truncate">
                              <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{res.building}</span>
                            </div>

                            {/* Features Row */}
                            <div className="flex items-center gap-2 text-[11px] text-gray-600 mt-2.5 flex-wrap">
                              <span className="flex items-center gap-1 font-bold text-gray-800">
                                <Users className="w-3.5 h-3.5 text-gray-400" />
                                {res.capacity}
                              </span>
                              {res.amenities.slice(0, 2).map((amenity) => (
                                <span
                                  key={amenity}
                                  className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[90px]"
                                >
                                  {amenity}
                                </span>
                              ))}
                              {res.amenities.length > 2 && (
                                <span className="text-[10px] text-gray-400 font-semibold">
                                  +{res.amenities.length - 2}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Operating Hours Info */}
                          <div className="flex items-center justify-between text-[11px] pt-2 border-t border-gray-100">
                            <span className="text-gray-400 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-gray-400" />
                              {res.operatingHours || '08:00 AM - 08:00 PM'}
                            </span>
                            <span className="text-emerald-700 font-semibold text-[10px]">
                              {res.requiresApproval ? 'Needs Approval' : 'Direct Booking'}
                            </span>
                          </div>

                          {/* Action Buttons */}
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
                              disabled={res.isUnderMaintenance}
                              onClick={() => handleOpenBooking(res)}
                              className={`py-1.5 px-2 text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-1 ${
                                res.isUnderMaintenance
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-[#F58220] hover:bg-[#E06D0C] text-white'
                              }`}
                            >
                              <span>Reserve</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Server-Side Pagination Bar */}
              {data && data.pagination.totalPages > 1 && (
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between flex-wrap gap-3">
                  <div className="text-xs text-gray-500 font-medium">
                    Page <span className="font-bold text-gray-800">{data.pagination.page}</span> of{' '}
                    <span className="font-bold text-gray-800">{data.pagination.totalPages}</span> ({data.pagination.total} total items)
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!data.pagination.hasPrevPage}
                      onClick={() => handlePageChange(data.pagination.page - 1)}
                      aria-label="Previous page"
                      className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>

                    <button
                      type="button"
                      disabled={!data.pagination.hasNextPage}
                      onClick={() => handlePageChange(data.pagination.page + 1)}
                      aria-label="Next page"
                      className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition flex items-center gap-1"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
        preselectedResource={selectedBookingResource}
        preselectedDate={bookingPreselectDate}
        preselectedStartTime={bookingPreselectStartTime}
        preselectedEndTime={bookingPreselectEndTime}
        onBookingSuccess={() => fetchResources()}
      />

      {/* Resource Detail Modal */}
      <ResourceDetailModal
        resource={detailModalResource}
        isOpen={!!detailModalResource}
        onClose={() => setDetailModalResource(null)}
        onReserve={(res, date, start, end) => {
          setDetailModalResource(null);
          handleOpenBooking(res, date, start, end);
        }}
      />
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-8">
          <div className="w-10 h-10 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ResourcesContent />
    </Suspense>
  );
}
