#!/usr/bin/env bash
set -e

BASE_URL="http://127.0.0.1:3000/api"
CRON_SECRET=$(grep '^CRON_SECRET=' apps/web/.env | cut -d'"' -f2)
if [ -z "$CRON_SECRET" ]; then
  CRON_SECRET="lpu_cron_secret_token_2026_secure"
fi

echo "=== STARTING SMOKE TESTS AGAINST NEXT.JS ROUTE HANDLERS ==="

echo "1. Checking Health endpoint..."
HEALTH_RES=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
HEALTH_CODE=$(echo "$HEALTH_RES" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RES" | sed '$d')
if [ "$HEALTH_CODE" != "200" ]; then
  echo "FAIL: Health returned status $HEALTH_CODE ($HEALTH_BODY)"
  exit 1
fi
echo "PASS: Health status 200 OK: $HEALTH_BODY"

echo "2. Logging in as Student (ketan.12204598@lpu.in)..."
STUDENT_RES=$(curl -s -i -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"ketan.12204598@lpu.in","password":"Password@123"}')
STUDENT_CODE=$(echo "$STUDENT_RES" | grep -i "HTTP/" | head -n1 | awk '{print $2}')
STUDENT_BODY=$(echo "$STUDENT_RES" | awk 'BEGIN{RS="\r\n\r\n"} NR==2')
STUDENT_TOKEN=$(echo "$STUDENT_BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$STUDENT_TOKEN" ]; then
  echo "Trying fallback password 'Lpu@12345'..."
  STUDENT_RES=$(curl -s -i -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ketan.12204598@lpu.in","password":"Lpu@12345"}')
  STUDENT_CODE=$(echo "$STUDENT_RES" | grep -i "HTTP/" | head -n1 | awk '{print $2}')
  STUDENT_BODY=$(echo "$STUDENT_RES" | awk 'BEGIN{RS="\r\n\r\n"} NR==2')
  STUDENT_TOKEN=$(echo "$STUDENT_BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$STUDENT_TOKEN" ]; then
  echo "FAIL: Could not authenticate student: $STUDENT_BODY"
  exit 1
fi
echo "PASS: Student authenticated (Token acquired, Cookie set in headers)"

echo "3. Logging in as Approver (approver.sece@lpu.in)..."
APPROVER_RES=$(curl -s -i -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"approver.sece@lpu.in","password":"Password@123"}')
APPROVER_CODE=$(echo "$APPROVER_RES" | grep -i "HTTP/" | head -n1 | awk '{print $2}')
APPROVER_BODY=$(echo "$APPROVER_RES" | awk 'BEGIN{RS="\r\n\r\n"} NR==2')
APPROVER_TOKEN=$(echo "$APPROVER_BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$APPROVER_TOKEN" ]; then
  echo "Trying fallback password 'Lpu@12345'..."
  APPROVER_RES=$(curl -s -i -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"approver.sece@lpu.in","password":"Lpu@12345"}')
  APPROVER_BODY=$(echo "$APPROVER_RES" | awk 'BEGIN{RS="\r\n\r\n"} NR==2')
  APPROVER_TOKEN=$(echo "$APPROVER_BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$APPROVER_TOKEN" ]; then
  echo "FAIL: Could not authenticate approver: $APPROVER_BODY"
  exit 1
fi
echo "PASS: Approver authenticated"

echo "4. Listing Resources (GET /api/resources)..."
RESOURCES_RES=$(curl -s "$BASE_URL/resources")
RESOURCE_ID=$(echo "$RESOURCES_RES" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
RESOURCE_NAME=$(echo "$RESOURCES_RES" | grep -o '"name":"[^"]*' | head -n1 | cut -d'"' -f4)
echo "PASS: Found resource: $RESOURCE_NAME (ID: $RESOURCE_ID)"

# Pick dynamic future window to ensure a clean unbooked slot every test run
RAND_DAYS=$(( (RANDOM % 4) + 6 ))
DAY_OFFSET=$(date -v+${RAND_DAYS}d +"%Y-%m-%d" 2>/dev/null || date -d "+${RAND_DAYS} days" +"%Y-%m-%d")
RAND_HOUR=$(( (RANDOM % 3) + 14 ))
END_HOUR=$(( RAND_HOUR + 1 ))
START_TIME="${DAY_OFFSET}T${RAND_HOUR}:00:00.000Z"
END_TIME="${DAY_OFFSET}T${END_HOUR}:30:00.000Z"
OVERLAP_START="${DAY_OFFSET}T${RAND_HOUR}:15:00.000Z"
OVERLAP_END="${DAY_OFFSET}T$(( END_HOUR + 1 )):00:00.000Z"

echo "5. Creating booking for $RESOURCE_NAME ($START_TIME to $END_TIME)..."
BOOKING_PAYLOAD="{\"resourceId\":\"$RESOURCE_ID\",\"startTime\":\"$START_TIME\",\"endTime\":\"$END_TIME\",\"purpose\":\"Smoke Test Booking Automated Verification\",\"expectedAttendance\":10,\"priority\":\"NORMAL\",\"activityType\":\"PROJECT_WORK\"}"

CREATE_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "$BOOKING_PAYLOAD")

CREATE_CODE=$(echo "$CREATE_RES" | tail -n1)
CREATE_BODY=$(echo "$CREATE_RES" | sed '$d')

if [ "$CREATE_CODE" != "201" ]; then
  echo "FAIL: Failed to create booking (Code $CREATE_CODE): $CREATE_BODY"
  exit 1
fi

BOOKING_ID=$(echo "$CREATE_BODY" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
CHECKIN_TOKEN=$(echo "$CREATE_BODY" | grep -o '"checkInToken":"[^"]*' | head -n1 | cut -d'"' -f4)
BOOKING_STATUS=$(echo "$CREATE_BODY" | grep -o '"status":"[^"]*' | head -n1 | cut -d'"' -f4)
echo "PASS: Booking created successfully (ID: $BOOKING_ID, Status: $BOOKING_STATUS, PIN: $CHECKIN_TOKEN)"

echo "6. Proving double-booking prevention returns 409..."
OVERLAP_PAYLOAD="{\"resourceId\":\"$RESOURCE_ID\",\"startTime\":\"$OVERLAP_START\",\"endTime\":\"$OVERLAP_END\",\"purpose\":\"Conflicting Booking Test\",\"expectedAttendance\":5}"
OVERLAP_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "$OVERLAP_PAYLOAD")

OVERLAP_CODE=$(echo "$OVERLAP_RES" | tail -n1)
OVERLAP_BODY=$(echo "$OVERLAP_RES" | sed '$d')

if [ "$OVERLAP_CODE" != "409" ]; then
  echo "FAIL: Expected 409 on overlapping slot, got $OVERLAP_CODE ($OVERLAP_BODY)"
  exit 1
fi
echo "PASS: Overlapping booking correctly rejected with HTTP 409 Slot Conflict!"

echo "7. Approving booking via Approver (POST /api/approvals/$BOOKING_ID/action)..."
APPROVE_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/approvals/$BOOKING_ID/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $APPROVER_TOKEN" \
  -d '{"action":"APPROVE","notes":"Approved in smoke test run"}')

APPROVE_CODE=$(echo "$APPROVE_RES" | tail -n1)
APPROVE_BODY=$(echo "$APPROVE_RES" | sed '$d')

if [ "$APPROVE_CODE" != "200" ]; then
  echo "FAIL: Approver action failed with code $APPROVE_CODE ($APPROVE_BODY)"
  exit 1
fi
NEW_CHECKIN_TOKEN=$(echo "$APPROVE_BODY" | grep -o '"checkInToken":"[^"]*' | head -n1 | cut -d'"' -f4)
if [ -n "$NEW_CHECKIN_TOKEN" ]; then
  CHECKIN_TOKEN="$NEW_CHECKIN_TOKEN"
fi
echo "PASS: Booking approved successfully. Confirmed PIN: $CHECKIN_TOKEN"

echo "8. Verifying check-in verification endpoint (POST /api/checkin/verify)..."
CHECKIN_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/checkin/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "{\"token\":\"$CHECKIN_TOKEN\"}")

CHECKIN_CODE=$(echo "$CHECKIN_RES" | tail -n1)
CHECKIN_BODY=$(echo "$CHECKIN_RES" | sed '$d')
# Note: Checkin may enforce 30-min window before start time (which is expected business logic) or succeed if inside window
if [ "$CHECKIN_CODE" == "200" ]; then
  echo "PASS: Check-in verified successfully: $CHECKIN_BODY"
elif [ "$CHECKIN_CODE" == "400" ] && echo "$CHECKIN_BODY" | grep -q "Check-in opens 30 minutes prior"; then
  echo "PASS: Check-in window validation enforced correctly (Opens 30 mins before start time)."
else
  echo "FAIL: Unexpected check-in response (Code $CHECKIN_CODE): $CHECKIN_BODY"
  exit 1
fi

echo "9. Testing CRON auto-release without authorization header (assert 401)..."
CRON_UNAUTH_RES=$(curl -s -w "\n%{http_code}" "$BASE_URL/cron/auto-release")
CRON_UNAUTH_CODE=$(echo "$CRON_UNAUTH_RES" | tail -n1)
if [ "$CRON_UNAUTH_CODE" != "401" ]; then
  echo "FAIL: Expected 401 for unauthorized cron call, got $CRON_UNAUTH_CODE"
  exit 1
fi
echo "PASS: Unauthorized cron call blocked with 401 Unauthorized."

echo "10. Testing CRON auto-release with valid Bearer CRON_SECRET (assert 200)..."
CRON_AUTH_RES=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/cron/auto-release")
CRON_AUTH_CODE=$(echo "$CRON_AUTH_RES" | tail -n1)
CRON_AUTH_BODY=$(echo "$CRON_AUTH_RES" | sed '$d')

if [ "$CRON_AUTH_CODE" != "200" ]; then
  echo "FAIL: Authorized cron call failed with code $CRON_AUTH_CODE ($CRON_AUTH_BODY)"
  exit 1
fi
echo "PASS: Authorized cron call succeeded with 200 OK: $CRON_AUTH_BODY"

echo "=== ALL SMOKE TESTS PASSED PERFECTLY ==="
