import { PrismaClient, Role, ResourceCategory, BookingStatus, ActivityType, PriorityLevel } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding LPU Campus Database...');

  // Clean existing records in reverse dependency order
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.timetableEntry.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.departmentPolicy.deleteMany({});
  await prisma.user.deleteMany({});

  const defaultPasswordHash = await bcrypt.hash('Lpu@12345', 10);

  // 1. Create Users for all 4 Roles
  const studentKetan = await prisma.user.create({
    data: {
      email: 'ketan.12204598@lpu.in',
      passwordHash: defaultPasswordHash,
      name: 'Ketan Meshram',
      role: Role.STUDENT,
      regNo: '12204598',
      department: 'School of Computer Science & Engineering',
      designation: 'B.Tech CSE (3rd Year)',
      phone: '+91 98765 43210',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
    },
  });

  const studentAastha = await prisma.user.create({
    data: {
      email: 'aastha.12108742@lpu.in',
      passwordHash: defaultPasswordHash,
      name: 'Aastha Sharma',
      role: Role.STUDENT,
      regNo: '12108742',
      department: 'School of Electronics & Electrical Engineering',
      designation: 'B.Tech ECE (4th Year)',
      phone: '+91 98765 43211',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
    },
  });

  const facultyArvind = await prisma.user.create({
    data: {
      email: 'arvind.cse@lpu.in',
      passwordHash: defaultPasswordHash,
      name: 'Dr. Arvind Sharma',
      role: Role.FACULTY,
      regNo: 'UID-23841',
      department: 'School of Computer Science & Engineering',
      designation: 'Associate Professor & AI Lab Head',
      phone: '+91 98765 43212',
      avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80',
    },
  });

  const approverMeenakshi = await prisma.user.create({
    data: {
      email: 'approver.sece@lpu.in',
      passwordHash: defaultPasswordHash,
      name: 'Prof. Meenakshi Sundaram',
      role: Role.DEPARTMENT_APPROVER,
      regNo: 'UID-10928',
      department: 'School of Computer Science & Engineering',
      designation: 'HOD & Department Resource In-charge',
      phone: '+91 98765 43213',
      avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
    },
  });

  const adminRajesh = await prisma.user.create({
    data: {
      email: 'admin.estate@lpu.in',
      passwordHash: defaultPasswordHash,
      name: 'Rajesh Verma',
      role: Role.ADMINISTRATOR,
      regNo: 'ADM-0042',
      department: 'Campus Infrastructure & Estate Management',
      designation: 'Chief Facilities & Asset Administrator',
      phone: '+91 98765 43214',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
    },
  });

  console.log('✅ Users created successfully (4 roles)');

  // 2. Department Policies
  await prisma.departmentPolicy.createMany({
    data: [
      {
        department: 'School of Computer Science & Engineering',
        maxAdvanceDays: 14,
        maxBookingHoursPerWeek: 16,
        requireFacultyEndorsement: false,
        autoReleaseMinutes: 15,
        autoApproveStudentHours: 2,
      },
      {
        department: 'School of Electronics & Electrical Engineering',
        maxAdvanceDays: 10,
        maxBookingHoursPerWeek: 12,
        requireFacultyEndorsement: true,
        autoReleaseMinutes: 15,
        autoApproveStudentHours: 2,
      },
      {
        department: 'Sports Complex & Athletics',
        maxAdvanceDays: 7,
        maxBookingHoursPerWeek: 10,
        requireFacultyEndorsement: false,
        autoReleaseMinutes: 10,
        autoApproveStudentHours: 2,
      },
      {
        department: 'Estate & Transport Office',
        maxAdvanceDays: 30,
        maxBookingHoursPerWeek: 40,
        requireFacultyEndorsement: true,
        autoReleaseMinutes: 30,
        autoApproveStudentHours: 0,
      },
    ],
  });

  // 3. Realistic Campus Resources
  const resourcesData = [
    {
      code: 'CSE-CR-204',
      name: 'CSE Classroom 204',
      category: ResourceCategory.CLASSROOM,
      department: 'School of Computer Science & Engineering',
      building: 'CSE Block 34',
      floor: '2nd Floor',
      capacity: 60,
      amenities: ['Projector', 'Smart Board', 'AC', 'Whiteboard', 'WiFi 6'],
      imageUrl: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '08:00 AM - 08:00 PM',
    },
    {
      code: 'CSE-LAB-03',
      name: 'Computer Lab 3',
      category: ResourceCategory.LAB,
      department: 'School of Computer Science & Engineering',
      building: 'CSE Block 34',
      floor: 'Ground Floor',
      capacity: 40,
      amenities: ['High End PCs', 'Lab Software', 'AC', 'Gigabit LAN', 'Whiteboard'],
      imageUrl: 'https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '09:00 AM - 06:00 PM',
    },
    {
      code: 'MAIN-SEM-01',
      name: 'Seminar Hall 1',
      category: ResourceCategory.SEMINAR_HALL,
      department: 'Central Academic Facilities',
      building: 'Main Academic Block 32',
      floor: '1st Floor',
      capacity: 120,
      amenities: ['Projector', 'Audio System', 'AC', 'Wireless Mics', 'Podium'],
      imageUrl: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '10:00 AM - 08:00 PM',
    },
    {
      code: 'ADM-MR-A1',
      name: 'Meeting Room A1',
      category: ResourceCategory.MEETING_ROOM,
      department: 'Administration & Executive',
      building: 'Admin Block 30',
      floor: '3rd Floor',
      capacity: 12,
      amenities: ['Display Screen', 'Whiteboard', 'Video Conferencing', 'AC'],
      imageUrl: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: false,
      operatingHours: '02:00 PM - 08:00 PM',
    },
    {
      code: 'SPT-BDM-01',
      name: 'Badminton Court',
      category: ResourceCategory.SPORTS,
      department: 'Sports Complex & Athletics',
      building: 'Sports Complex Block 19',
      floor: 'Ground Floor',
      capacity: 8,
      amenities: ['Court + Equipment', 'Changing Room', 'Floodlights', 'Sports Equipment'],
      imageUrl: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '06:00 AM - 10:00 PM',
    },
    {
      code: 'EQ-PRJ-08',
      name: 'Projector (Portable)',
      category: ResourceCategory.EQUIPMENT,
      department: 'Central IT & Equipment Hub',
      building: 'Equipment Center Block 32',
      floor: 'Basement',
      capacity: 1,
      amenities: ['HD Projector', 'HDMI / VGA', 'Carry Case', 'Wireless Dongle'],
      imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '08:00 AM - 08:00 PM',
    },
    {
      code: 'ECE-LAB-01',
      name: 'Electronics Lab 1',
      category: ResourceCategory.LAB,
      department: 'School of Electronics & Electrical Engineering',
      building: 'ECE Block 36',
      floor: '1st Floor',
      capacity: 30,
      amenities: ['Oscilloscope', 'Signal Generator', 'Digital Multimeter', 'AC'],
      imageUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '09:00 AM - 06:00 PM',
    },
    {
      code: 'LT-CR-05',
      name: 'LT Classroom 5',
      category: ResourceCategory.CLASSROOM,
      department: 'Central Academic Facilities',
      building: 'LT Block 32',
      floor: '2nd Floor',
      capacity: 80,
      amenities: ['Projector', 'Smart Board', 'AC', 'Tiered Desks', 'Audio System'],
      imageUrl: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '12:00 PM - 04:00 PM',
    },
    {
      code: 'TRP-BUS-12',
      name: 'Campus Bus (Event Use)',
      category: ResourceCategory.VEHICLE,
      department: 'Estate & Transport Office',
      building: 'Transport Office Gate 1',
      floor: 'Parking Bay B',
      capacity: 45,
      amenities: ['AC', 'For Official Events', 'Luggage Compartment', 'First Aid'],
      imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: false,
      operatingHours: 'Minimum 1 day prior notice',
    },
    {
      code: 'CSE-CR-301',
      name: 'Smart Classroom 301',
      category: ResourceCategory.CLASSROOM,
      department: 'School of Computer Science & Engineering',
      building: 'CSE Block 33',
      floor: '3rd Floor',
      capacity: 40,
      amenities: ['Projector', 'Smart Board', 'AC', 'Discussion Pods'],
      imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '08:00 AM - 07:00 PM',
    },
    {
      code: 'SAC-SEM-02',
      name: 'Seminar Hall 2',
      category: ResourceCategory.SEMINAR_HALL,
      department: 'Student Welfare & Cultural Affairs',
      building: 'Student Activity Center Block 13',
      floor: '2nd Floor',
      capacity: 150,
      amenities: ['Stage Lighting', 'Dual Screen Projector', 'AC', 'Sound System'],
      imageUrl: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '10:00 AM - 09:00 PM',
    },
    {
      code: 'AUD-SDM-01',
      name: 'Shanti Devi Mittal Auditorium',
      category: ResourceCategory.SEMINAR_HALL,
      department: 'Central Estate & Events',
      building: 'Uni-Auditorium Complex',
      floor: 'Ground Floor',
      capacity: 650,
      amenities: ['Grand Stage', 'Line Array Audio', 'Theatrical Lighting', 'Green Rooms', 'VIP Lounge'],
      imageUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '09:00 AM - 10:00 PM',
    },
    {
      code: 'ROBO-LAB-01',
      name: 'AI & Robotics Innovation Lab',
      category: ResourceCategory.LAB,
      department: 'School of Computer Science & Engineering',
      building: 'CSE Block 34',
      floor: '4th Floor',
      capacity: 35,
      amenities: ['GPU Workstations', 'ROS Kits', '3D Printers', 'AC', 'Lab Software'],
      imageUrl: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '09:00 AM - 08:00 PM',
    },
    {
      code: 'SPT-SQ-02',
      name: 'Squash Court 2',
      category: ResourceCategory.SPORTS,
      department: 'Sports Complex & Athletics',
      building: 'Sports Complex Block 19',
      floor: '1st Floor',
      capacity: 4,
      amenities: ['Glass Back Wall', 'Wooden Flooring', 'Viewing Gallery'],
      imageUrl: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      isAvailableNow: true,
      operatingHours: '06:00 AM - 09:00 PM',
    },
    {
      code: 'EQ-CAM-4K',
      name: '4K Multi-Cam Broadcast Rig',
      category: ResourceCategory.EQUIPMENT,
      department: 'Central Media Center',
      building: 'Media Center Block 14',
      floor: '2nd Floor',
      capacity: 1,
      amenities: ['Sony FX3 Rig', 'Wireless Audio', 'Live Stream Switcher', 'Tripods'],
      imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '09:00 AM - 06:00 PM',
    },
    {
      code: 'TRP-VIP-EC',
      name: 'VIP Campus Electric Shuttle (E-Cart 1)',
      category: ResourceCategory.VEHICLE,
      department: 'Estate & Transport Office',
      building: 'Main Gate 1 Bay',
      floor: 'Ground',
      capacity: 8,
      amenities: ['Electric Powered', 'All-Weather Canopy', 'Campus Tour PA'],
      imageUrl: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      isAvailableNow: true,
      operatingHours: '08:00 AM - 06:00 PM',
    },
  ];

  const createdResources: Record<string, any> = {};
  for (const item of resourcesData) {
    const res = await prisma.resource.create({ data: item });
    createdResources[item.code] = res;
  }
  console.log(`✅ Created ${resourcesData.length} Campus Resources`);

  // 4. Timetable Entries (Academic Timetable for Conflict Checks)
  // Day of week: 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday
  await prisma.timetableEntry.createMany({
    data: [
      {
        resourceId: createdResources['CSE-CR-204'].id,
        courseCode: 'INT-306',
        courseName: 'Database Management Systems',
        instructorName: 'Dr. Arvind Sharma',
        dayOfWeek: 1, // Monday
        startTime: '10:00',
        endTime: '11:50',
        department: 'School of Computer Science & Engineering',
        semester: '5th Semester',
        section: 'K22ER',
      },
      {
        resourceId: createdResources['CSE-CR-204'].id,
        courseCode: 'CSE-316',
        courseName: 'Design and Analysis of Algorithms',
        instructorName: 'Dr. Arvind Sharma',
        dayOfWeek: 2, // Tuesday
        startTime: '10:00',
        endTime: '11:50',
        department: 'School of Computer Science & Engineering',
        semester: '5th Semester',
        section: 'K22ER',
      },
      {
        resourceId: createdResources['CSE-LAB-03'].id,
        courseCode: 'CAP-776',
        courseName: 'Advanced Web Applications Lab',
        instructorName: 'Prof. Meenakshi Sundaram',
        dayOfWeek: 4, // Thursday
        startTime: '14:00',
        endTime: '16:00',
        department: 'School of Computer Science & Engineering',
        semester: '5th Semester',
        section: 'K22ER',
      },
      {
        resourceId: createdResources['ECE-LAB-01'].id,
        courseCode: 'ECE-212',
        courseName: 'Analog Circuits Practical',
        instructorName: 'Dr. Neha Patel',
        dayOfWeek: 3, // Wednesday
        startTime: '09:00',
        endTime: '11:00',
        department: 'School of Electronics & Electrical Engineering',
        semester: '3rd Semester',
        section: 'E21AB',
      },
      {
        resourceId: createdResources['LT-CR-05'].id,
        courseCode: 'MTH-401',
        courseName: 'Discrete Mathematics Lecture',
        instructorName: 'Dr. R. K. Singla',
        dayOfWeek: 5, // Friday
        startTime: '09:00',
        endTime: '11:00',
        department: 'Central Academic Facilities',
        semester: '3rd Semester',
        section: 'ALL-SEC',
      },
    ],
  });

  console.log('✅ Academic Timetable entries seeded');

  // 5. Realistic Seed Bookings matching Screenshot 1
  const today = new Date();
  today.setHours(14, 0, 0, 0); // Today 2:00 PM
  const todayEnd = new Date(today);
  todayEnd.setHours(16, 0, 0, 0); // Today 4:00 PM

  const booking1 = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-4091',
      userId: studentKetan.id,
      resourceId: createdResources['CSE-CR-204'].id,
      startTime: today,
      endTime: todayEnd,
      purpose: 'Class Discussion on DAA Project & Group Allocation',
      activityType: ActivityType.PROJECT_WORK,
      expectedAttendance: 25,
      priority: PriorityLevel.HIGH,
      status: BookingStatus.CONFIRMED,
      checkInToken: '739201',
      releaseDeadline: new Date(today.getTime() + 15 * 60000), // 15 mins after start
    },
  });

  const nextThu = new Date();
  nextThu.setDate(today.getDate() + 3);
  nextThu.setHours(10, 0, 0, 0);
  const nextThuEnd = new Date(nextThu);
  nextThuEnd.setHours(12, 0, 0, 0);

  const booking2 = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-4108',
      userId: studentKetan.id,
      resourceId: createdResources['CSE-LAB-03'].id,
      startTime: nextThu,
      endTime: nextThuEnd,
      purpose: 'Project Work - Distributed Systems Benchmark Testing',
      activityType: ActivityType.PROJECT_WORK,
      expectedAttendance: 15,
      priority: PriorityLevel.NORMAL,
      status: BookingStatus.CONFIRMED,
      checkInToken: '582014',
      releaseDeadline: new Date(nextThu.getTime() + 15 * 60000),
    },
  });

  const nextMon = new Date();
  nextMon.setDate(today.getDate() + 5);
  nextMon.setHours(15, 0, 0, 0);
  const nextMonEnd = new Date(nextMon);
  nextMonEnd.setHours(17, 0, 0, 0);

  const booking3 = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-4182',
      userId: studentKetan.id,
      resourceId: createdResources['SAC-SEM-02'].id,
      startTime: nextMon,
      endTime: nextMonEnd,
      purpose: 'Club Event: Google Developer Student Club Annual Tech Talk & Ideathon',
      activityType: ActivityType.CLUB_EVENT,
      expectedAttendance: 110,
      priority: PriorityLevel.HIGH,
      status: BookingStatus.PENDING,
      approvalNotes: 'Pending approval by School of CSE Resource Approver',
    },
  });

  // Additional pending requests for approver & admin workflows
  const bookingFacultyPending = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-4219',
      userId: facultyArvind.id,
      resourceId: createdResources['MAIN-SEM-01'].id,
      startTime: new Date(Date.now() + 86400000 * 2),
      endTime: new Date(Date.now() + 86400000 * 2 + 7200000),
      purpose: 'Guest Lecture: Scalable Microservices Architecture with Industry Expert',
      activityType: ActivityType.GUEST_SEMINAR,
      expectedAttendance: 95,
      priority: PriorityLevel.HIGH,
      status: BookingStatus.PENDING,
    },
  });

  const bookingSportsPending = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-4255',
      userId: studentAastha.id,
      resourceId: createdResources['SPT-BDM-01'].id,
      startTime: new Date(Date.now() + 86400000 * 1),
      endTime: new Date(Date.now() + 86400000 * 1 + 3600000 * 2),
      purpose: 'Inter-School Badminton Tournament Trials',
      activityType: ActivityType.SPORTS_PRACTICE,
      expectedAttendance: 12,
      priority: PriorityLevel.NORMAL,
      status: BookingStatus.PENDING,
    },
  });

  // Past check-in, completed and no-show bookings for Analytics
  const pastCompleted1 = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-3891',
      userId: studentKetan.id,
      resourceId: createdResources['CSE-CR-301'].id,
      startTime: new Date(Date.now() - 86400000 * 2),
      endTime: new Date(Date.now() - 86400000 * 2 + 7200000),
      purpose: 'Hackathon Practice Session',
      activityType: ActivityType.CLUB_EVENT,
      expectedAttendance: 35,
      priority: PriorityLevel.NORMAL,
      status: BookingStatus.COMPLETED,
      checkInToken: '120934',
      checkedInAt: new Date(Date.now() - 86400000 * 2 + 300000),
    },
  });

  const pastNoShow = await prisma.booking.create({
    data: {
      bookingNumber: 'LPU-2026-3810',
      userId: studentAastha.id,
      resourceId: createdResources['ADM-MR-A1'].id,
      startTime: new Date(Date.now() - 86400000 * 3),
      endTime: new Date(Date.now() - 86400000 * 3 + 3600000),
      purpose: 'Core Team Planning',
      activityType: ActivityType.FACULTY_MEETING,
      expectedAttendance: 8,
      priority: PriorityLevel.NORMAL,
      status: BookingStatus.NO_SHOW,
      approvalNotes: 'Auto-released by system after 15 minute check-in window expired.',
    },
  });

  console.log('✅ Realistic Bookings created');

  // 6. User Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: studentKetan.id,
        title: 'Booking Confirmed: CSE Classroom 204',
        message: 'Your reservation for CSE Classroom 204 today at 2:00 PM is confirmed. Check-in code is 739201.',
        type: 'BOOKING',
        read: false,
        link: '/my-bookings',
      },
      {
        userId: studentKetan.id,
        title: 'Check-in Reminder',
        message: 'Remember to scan QR or enter 739201 within 15 mins of start time to prevent automatic cancellation.',
        type: 'CHECKIN',
        read: false,
        link: '/my-bookings',
      },
      {
        userId: studentKetan.id,
        title: 'Request Under Review: Seminar Hall 2',
        message: 'Your club event request for Seminar Hall 2 has been submitted to Prof. Meenakshi Sundaram.',
        type: 'APPROVAL',
        read: true,
        link: '/my-bookings',
      },
      {
        userId: approverMeenakshi.id,
        title: 'New Booking Request Pending Approval',
        message: 'Ketan Meshram requested Seminar Hall 2 for GDSC Tech Talk (110 attendees).',
        type: 'APPROVAL',
        read: false,
        link: '/approvals',
      },
      {
        userId: approverMeenakshi.id,
        title: 'Guest Lecture Approval Request',
        message: 'Dr. Arvind Sharma requested Seminar Hall 1 for an Industry Expert Lecture.',
        type: 'APPROVAL',
        read: false,
        link: '/approvals',
      },
    ],
  });

  console.log('✅ Notifications seeded');

  // 7. Audit Log
  await prisma.auditLog.createMany({
    data: [
      {
        action: 'BOOKING_CREATED',
        userId: studentKetan.id,
        entityType: 'Booking',
        entityId: booking1.id,
        details: 'Created confirmed booking for CSE Classroom 204',
      },
      {
        action: 'POLICY_APPLIED',
        userId: approverMeenakshi.id,
        entityType: 'DepartmentPolicy',
        entityId: 'School of Computer Science & Engineering',
        details: 'Verified auto-approve threshold of 2 hours for student group study',
      },
    ],
  });

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

