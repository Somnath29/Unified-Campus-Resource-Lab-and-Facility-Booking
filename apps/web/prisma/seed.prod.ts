import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🔒 Starting production database seed...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin.estate@lpu.in';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'LpuAdmin@2026Secure';

  console.log(`Setting up initial administrator: ${adminEmail}`);
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // 1. Create or ensure one initial ADMINISTRATOR
  const admin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {
      role: Role.ADMINISTRATOR,
      isActive: true,
    },
    create: {
      email: adminEmail.toLowerCase(),
      passwordHash,
      name: 'System Administrator',
      role: Role.ADMINISTRATOR,
      department: 'Campus Infrastructure & Estate Management',
      designation: 'Chief Campus Administrator',
      phone: '+91 98765 43214',
      isActive: true,
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
    },
  });

  console.log(`✅ Production Administrator established: ${admin.name} (${admin.email})`);

  // 2. Establish default DepartmentPolicy rows
  const defaultPolicies = [
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
  ];

  for (const policy of defaultPolicies) {
    await prisma.departmentPolicy.upsert({
      where: { department: policy.department },
      update: {},
      create: policy,
    });
  }

  console.log('✅ Default department policies established successfully.');
  console.log('🔒 Production seed finished.');
}

main()
  .catch((e) => {
    console.error('❌ Production seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
