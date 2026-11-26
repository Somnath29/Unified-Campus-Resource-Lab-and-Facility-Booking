-- CreateIndex
CREATE INDEX "Resource_category_idx" ON "Resource"("category");

-- CreateIndex
CREATE INDEX "Resource_building_idx" ON "Resource"("building");

-- CreateIndex
CREATE INDEX "Resource_department_idx" ON "Resource"("department");

-- CreateIndex
CREATE INDEX "Resource_capacity_idx" ON "Resource"("capacity");

-- CreateIndex
CREATE INDEX "Resource_deletedAt_idx" ON "Resource"("deletedAt");

-- CreateIndex
CREATE INDEX "TimetableEntry_resourceId_dayOfWeek_idx" ON "TimetableEntry"("resourceId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TimetableEntry_dayOfWeek_startTime_endTime_idx" ON "TimetableEntry"("dayOfWeek", "startTime", "endTime");
