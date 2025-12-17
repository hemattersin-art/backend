# Backend API Endpoints Classification

This document lists all backend API endpoints and classifies them as **NEEDED** or **NOT NEEDED** based on production requirements.

---

## 🔐 **Authentication Routes** (`/api/auth`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/auth/register/client` | POST | ✅ **NEEDED** | Client registration |
| `/api/auth/login` | POST | ✅ **NEEDED** | User login |
| `/api/auth/google-login` | POST | ✅ **NEEDED** | Google OAuth login |
| `/api/auth/forgot-password` | POST | ✅ **NEEDED** | Password reset OTP |
| `/api/auth/reset-password` | POST | ✅ **NEEDED** | Password reset |
| `/api/auth/profile` | GET | ✅ **NEEDED** | Get user profile |
| `/api/auth/profile-picture` | PUT | ✅ **NEEDED** | Update profile picture |
| `/api/auth/change-password` | PUT | ✅ **NEEDED** | Change password |
| `/api/auth/logout` | POST | ✅ **NEEDED** | User logout |

---

## 👤 **Client Routes** (`/api/clients`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/clients/profile` | GET | ✅ **NEEDED** | Get client profile |
| `/api/clients/profile` | PUT | ✅ **NEEDED** | Update client profile |
| `/api/clients/sessions` | GET | ✅ **NEEDED** | Get client sessions |
| `/api/clients/sessions/:sessionId` | GET | ✅ **NEEDED** | Get session details |
| `/api/clients/book-session` | POST | ✅ **NEEDED** | Book a session |
| `/api/clients/sessions/:sessionId/cancel` | PUT | ✅ **NEEDED** | Cancel session |
| `/api/clients/sessions/:sessionId/reschedule-request` | POST | ✅ **NEEDED** | Request reschedule |
| `/api/clients/sessions/:sessionId/reschedule` | PUT | ✅ **NEEDED** | Reschedule session |
| `/api/clients/sessions/:sessionId/free-assessment-availability` | GET | ✅ **NEEDED** | Get availability for reschedule |
| `/api/clients/sessions/:sessionId/feedback` | POST | ✅ **NEEDED** | Submit session feedback |
| `/api/clients/psychologists` | GET | ✅ **NEEDED** | Get available psychologists |
| `/api/clients/psychologists/:psychologistId/packages` | GET | ✅ **NEEDED** | Get psychologist packages |
| `/api/clients/book-remaining-session` | POST | ✅ **NEEDED** | Book remaining package session |
| `/api/clients/reserve-slot` | POST | ✅ **NEEDED** | Reserve time slot |
| `/api/clients/assessments/reserve-slot` | POST | ✅ **NEEDED** | Reserve assessment slot |
| `/api/clients/assessments/book` | POST | ✅ **NEEDED** | Book assessment |
| `/api/clients/assessments/sessions` | GET | ✅ **NEEDED** | Get assessment sessions |
| `/api/clients/assessments/sessions/:assessmentSessionId/reschedule` | PUT | ✅ **NEEDED** | Reschedule assessment |
| `/api/clients/packages` | GET | ✅ **NEEDED** | Get client packages |
| `/api/clients/receipts` | GET | ✅ **NEEDED** | Get client receipts |
| `/api/clients/receipts/:receiptId/download` | GET | ✅ **NEEDED** | Download receipt |
| `/api/clients/receipts/order/:orderId` | GET | ✅ **NEEDED** | Get receipt by order ID |

---

## 💳 **Payment Routes** (`/api/payment`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/payment/create-order` | POST | ✅ **NEEDED** | Create payment order |
| `/api/payment/cash` | POST | ✅ **NEEDED** | Create cash payment |
| `/api/payment/success` | POST | ✅ **NEEDED** | Payment success callback |
| `/api/payment/failure` | POST | ✅ **NEEDED** | Payment failure callback |
| `/api/payment/status/:transactionId` | GET | ✅ **NEEDED** | Get payment status |

---

## 🔔 **Notification Routes** (`/api/notifications`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/notifications` | GET | ✅ **NEEDED** | Get notifications |
| `/api/notifications/unread-count` | GET | ✅ **NEEDED** | Get unread count |
| `/api/notifications/:notificationId/read` | PUT | ✅ **NEEDED** | Mark as read |
| `/api/notifications/mark-all-read` | PUT | ✅ **NEEDED** | Mark all as read |
| `/api/notifications/:notificationId` | DELETE | ✅ **NEEDED** | Delete notification |

---

## 🔔 **Client Notification Routes** (`/api/client-notifications`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/client-notifications` | GET | ✅ **NEEDED** | Get client notifications |
| `/api/client-notifications/unread-count` | GET | ✅ **NEEDED** | Get unread count |
| `/api/client-notifications/:notificationId/read` | PUT | ✅ **NEEDED** | Mark as read |
| `/api/client-notifications/mark-all-read` | PUT | ✅ **NEEDED** | Mark all as read |
| `/api/client-notifications/:notificationId` | DELETE | ✅ **NEEDED** | Delete notification |

---

## 📅 **Availability Routes** (`/api/availability`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/availability/psychologist/:id` | GET | ✅ **NEEDED** | Get psychologist availability |
| `/api/availability/psychologist/:id/range` | GET | ✅ **NEEDED** | Get availability range |
| `/api/availability/psychologist/:id/check` | GET | ✅ **NEEDED** | Check slot availability |
| `/api/availability/psychologist/:id/working-hours` | GET | ✅ **NEEDED** | Get working hours |
| `/api/availability/public/psychologist/:id` | GET | ✅ **NEEDED** | Public availability (no auth) |

---

## 📅 **Availability Controller Routes** (`/api/availability-controller`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/availability-controller/sync-google-calendar` | POST | ✅ **NEEDED** | Sync Google Calendar |
| `/api/availability-controller/google-calendar-busy-times` | GET | ✅ **NEEDED** | Get busy times from Google Calendar |
| `/api/availability-controller/set` | POST | ✅ **NEEDED** | Set availability |
| `/api/availability-controller/get` | GET | ✅ **NEEDED** | Get availability |

---

## 🧑‍⚕️ **Psychologist Routes** (`/api/psychologists`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/psychologists/profile` | GET | ✅ **NEEDED** | Get psychologist profile |
| `/api/psychologists/profile` | PUT | ✅ **NEEDED** | Update psychologist profile |
| `/api/psychologists/sessions` | GET | ✅ **NEEDED** | Get psychologist sessions |
| `/api/psychologists/sessions/:sessionId` | PUT | ✅ **NEEDED** | Update session |
| `/api/psychologists/sessions/:sessionId/complete` | POST | ✅ **NEEDED** | Complete session |
| `/api/psychologists/sessions/:sessionId/reschedule-response` | POST | ✅ **NEEDED** | Respond to reschedule request |
| `/api/psychologists/sessions/:sessionId` | DELETE | ✅ **NEEDED** | Delete session |
| `/api/psychologists/assessment-sessions/:assessmentSessionId/schedule` | POST | ✅ **NEEDED** | Schedule assessment session |
| `/api/psychologists/assessment-sessions/:assessmentSessionId/reschedule` | PUT | ✅ **NEEDED** | Reschedule assessment |
| `/api/psychologists/assessment-sessions/:assessmentSessionId` | DELETE | ✅ **NEEDED** | Delete assessment session |
| `/api/psychologists/availability` | GET | ✅ **NEEDED** | Get availability |
| `/api/psychologists/availability` | POST | ✅ **NEEDED** | Add availability |
| `/api/psychologists/availability` | PUT | ✅ **NEEDED** | Update availability |
| `/api/psychologists/availability/:availabilityId` | DELETE | ✅ **NEEDED** | Delete availability |
| `/api/psychologists/packages` | GET | ✅ **NEEDED** | Get packages |
| `/api/psychologists/packages` | POST | ✅ **NEEDED** | Create package |
| `/api/psychologists/packages/:packageId` | PUT | ✅ **NEEDED** | Update package |
| `/api/psychologists/packages/:packageId` | DELETE | ✅ **NEEDED** | Delete package |
| `/api/psychologists/block-time` | POST | ✅ **NEEDED** | Block time slots |
| `/api/psychologists/unblock-time` | POST | ✅ **NEEDED** | Unblock time slots |
| `/api/psychologists/blocked-time` | GET | ✅ **NEEDED** | Get blocked time slots |

---

## 📋 **Session Routes** (`/api/sessions`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/sessions/book` | POST | ✅ **NEEDED** | Book session |
| `/api/sessions/client/:clientId` | GET | ✅ **NEEDED** | Get client sessions |
| `/api/sessions/psychologist/:psychologistId` | GET | ✅ **NEEDED** | Get psychologist sessions |
| `/api/sessions/admin/all` | GET | ✅ **NEEDED** | Get all sessions (admin) |
| `/api/sessions/:sessionId/status` | PUT | ✅ **NEEDED** | Update session status |
| `/api/sessions/:sessionId/complete` | PUT | ✅ **NEEDED** | Complete session |
| `/api/sessions/:sessionId` | DELETE | ✅ **NEEDED** | Delete session |
| `/api/sessions/reschedule-request/:notificationId` | PUT | ✅ **NEEDED** | Handle reschedule request |

---

## 📝 **Free Assessment Routes** (`/api/free-assessments`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/free-assessments/status` | GET | ✅ **NEEDED** | Get free assessment status |
| `/api/free-assessments/available-slots` | GET | ✅ **NEEDED** | Get available slots |
| `/api/free-assessments/availability-range` | GET | ✅ **NEEDED** | Get availability range |
| `/api/free-assessments/book` | POST | ✅ **NEEDED** | Book free assessment |
| `/api/free-assessments/cancel/:assessmentId` | PUT | ✅ **NEEDED** | Cancel free assessment |
| `/api/free-assessments/admin/list` | GET | ✅ **NEEDED** | Admin list assessments |
| `/api/free-assessments/test-timeslots` | GET | ❌ **NOT NEEDED** | Test endpoint - remove in production |
| `/api/free-assessments/test-date-configs` | GET | ❌ **NOT NEEDED** | Test endpoint - remove in production |

---

## 📅 **Free Assessment Timeslots Routes** (`/api/free-assessment-timeslots`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/free-assessment-timeslots` | GET | ✅ **NEEDED** | Get timeslots (admin) |
| `/api/free-assessment-timeslots/availability-range` | GET | ✅ **NEEDED** | Get availability range |
| `/api/free-assessment-timeslots` | POST | ✅ **NEEDED** | Add timeslot |
| `/api/free-assessment-timeslots/bulk` | POST | ✅ **NEEDED** | Add multiple timeslots |
| `/api/free-assessment-timeslots/:id` | PUT | ✅ **NEEDED** | Update timeslot |
| `/api/free-assessment-timeslots/:id` | DELETE | ✅ **NEEDED** | Delete timeslot |
| `/api/free-assessment-timeslots/bulk/update` | PUT | ✅ **NEEDED** | Bulk update timeslots |
| `/api/free-assessment-timeslots/date-config` | POST | ✅ **NEEDED** | Save date config |
| `/api/free-assessment-timeslots/date-config/:date` | GET | ✅ **NEEDED** | Get date config |
| `/api/free-assessment-timeslots/date-config/:date` | DELETE | ✅ **NEEDED** | Delete date config |
| `/api/free-assessment-timeslots/date-configs-range` | GET | ✅ **NEEDED** | Get date configs range |

---

## 📧 **Email Verification Routes** (`/api/email-verification`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/email-verification/send-otp` | POST | ✅ **NEEDED** | Send OTP |
| `/api/email-verification/verify-otp` | POST | ✅ **NEEDED** | Verify OTP |
| `/api/email-verification/check-status/:email` | GET | ✅ **NEEDED** | Check verification status |
| `/api/email-verification/resend-otp` | POST | ✅ **NEEDED** | Resend OTP |
| `/api/email-verification/cleanup` | DELETE | ⚠️ **CONDITIONAL** | Cleanup endpoint - use with caution |

---

## 📚 **Blog Routes** (`/api/blogs`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/blogs` | GET | ✅ **NEEDED** | Get all blogs (public) |
| `/api/blogs/slug/:slug` | GET | ✅ **NEEDED** | Get blog by slug |
| `/api/blogs/admin` | GET | ✅ **NEEDED** | Get all blogs (admin) |
| `/api/blogs/admin/:id` | GET | ✅ **NEEDED** | Get blog by ID (admin) |
| `/api/blogs/admin` | POST | ✅ **NEEDED** | Create blog (admin) |
| `/api/blogs/admin/:id` | PUT | ✅ **NEEDED** | Update blog (admin) |
| `/api/blogs/admin/:id` | DELETE | ✅ **NEEDED** | Delete blog (admin) |
| `/api/blogs/admin/upload-image` | POST | ✅ **NEEDED** | Upload blog image |
| `/api/blogs/admin/upload-multiple-images` | POST | ✅ **NEEDED** | Upload multiple images |
| `/api/blogs/test/create-dummy` | POST | ❌ **NOT NEEDED** | Test endpoint - remove in production |

---

## 🧠 **Counselling Routes** (`/api/counselling`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/counselling` | GET | ✅ **NEEDED** | Get all counselling services (public) |
| `/api/counselling/admin` | GET | ✅ **NEEDED** | Get all counselling services (admin) |
| `/api/counselling/admin/:id` | GET | ✅ **NEEDED** | Get counselling service by ID |
| `/api/counselling/admin` | POST | ✅ **NEEDED** | Create counselling service |
| `/api/counselling/admin/:id` | PUT | ✅ **NEEDED** | Update counselling service |
| `/api/counselling/admin/:id` | DELETE | ✅ **NEEDED** | Delete counselling service |
| `/api/counselling/admin/upload-image` | POST | ✅ **NEEDED** | Upload counselling image |
| `/api/counselling/:slug` | GET | ✅ **NEEDED** | Get counselling service by slug |

---

## 📊 **Assessments Routes** (`/api/assessments`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/assessments` | GET | ✅ **NEEDED** | Get all assessments (public) |
| `/api/assessments/:slug` | GET | ✅ **NEEDED** | Get assessment by slug |
| `/api/assessments/admin` | GET | ✅ **NEEDED** | Get all assessments (admin) |
| `/api/assessments/admin/:id` | GET | ✅ **NEEDED** | Get assessment by ID |
| `/api/assessments/admin` | POST | ✅ **NEEDED** | Create assessment |
| `/api/assessments/admin/:id` | PUT | ✅ **NEEDED** | Update assessment |
| `/api/assessments/admin/:id` | DELETE | ✅ **NEEDED** | Delete assessment |
| `/api/assessments/admin/upload-image` | POST | ✅ **NEEDED** | Upload assessment image |

---

## 👨‍👩‍👧 **Better Parenting Routes** (`/api/better-parenting`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/better-parenting` | GET | ✅ **NEEDED** | Get all better parenting content (public) |
| `/api/better-parenting/:slug` | GET | ✅ **NEEDED** | Get better parenting by slug |
| `/api/better-parenting/admin` | GET | ✅ **NEEDED** | Get all (admin) |
| `/api/better-parenting/admin/:id` | GET | ✅ **NEEDED** | Get by ID (admin) |
| `/api/better-parenting/admin` | POST | ✅ **NEEDED** | Create (admin) |
| `/api/better-parenting/admin/:id` | PUT | ✅ **NEEDED** | Update (admin) |
| `/api/better-parenting/admin/:id` | DELETE | ✅ **NEEDED** | Delete (admin) |

---

## 📅 **Google Calendar Routes** (`/api/google-calendar`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/google-calendar/connect` | POST | ✅ **NEEDED** | Connect Google Calendar |
| `/api/google-calendar/disconnect` | POST | ✅ **NEEDED** | Disconnect Google Calendar |
| `/api/google-calendar/status` | GET | ✅ **NEEDED** | Get connection status |
| `/api/google-calendar/events` | GET | ✅ **NEEDED** | Get calendar events |

---

## 💬 **Messages Routes** (`/api/messages`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/messages/conversations` | GET | ✅ **NEEDED** | Get conversations |
| `/api/messages/conversations/:conversationId/messages` | GET | ✅ **NEEDED** | Get messages |
| `/api/messages/conversations/:conversationId/messages` | POST | ✅ **NEEDED** | Send message |
| `/api/messages/conversations/:conversationId/read` | PUT | ✅ **NEEDED** | Mark as read |
| `/api/messages/conversations` | POST | ✅ **NEEDED** | Create conversation |

---

## 🔗 **Meet Routes** (`/api/meet`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/meet/events/meet` | POST | ✅ **NEEDED** | Create Meet event |
| `/api/meet/events/meet/status` | GET | ⚠️ **CONDITIONAL** | Check OAuth status - useful for debugging |

---

## 🔐 **OAuth Routes** (`/api/oauth`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/oauth/oauth2/url` | GET | ✅ **NEEDED** | Get OAuth URL |
| `/api/oauth/oauth2/callback` | GET | ✅ **NEEDED** | OAuth callback |
| `/api/oauth/conference-capabilities` | GET | ⚠️ **CONDITIONAL** | Diagnostic endpoint - useful for debugging |

---

## 👨‍💼 **Admin Routes** (`/api/admin`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/admin/users` | GET | ✅ **NEEDED** | Get all users |
| `/api/admin/users/:userId` | GET | ✅ **NEEDED** | Get user details |
| `/api/admin/users/:userId/role` | PUT | ✅ **NEEDED** | Update user role |
| `/api/admin/users/:userId/deactivate` | PUT | ✅ **NEEDED** | Deactivate user |
| `/api/admin/stats/platform` | GET | ✅ **NEEDED** | Get platform stats |
| `/api/admin/stats/dashboard` | GET | ✅ **NEEDED** | Get dashboard stats |
| `/api/admin/search/users` | GET | ✅ **NEEDED** | Search users |
| `/api/admin/activities` | GET | ✅ **NEEDED** | Get recent activities |
| `/api/admin/recent-users` | GET | ✅ **NEEDED** | Get recent users |
| `/api/admin/recent-bookings` | GET | ✅ **NEEDED** | Get recent bookings |
| `/api/admin/psychologists` | GET | ✅ **NEEDED** | Get all psychologists |
| `/api/admin/psychologists` | POST | ✅ **NEEDED** | Create psychologist |
| `/api/admin/psychologists/:psychologistId` | PUT | ✅ **NEEDED** | Update psychologist |
| `/api/admin/psychologists/:psychologistId` | DELETE | ✅ **NEEDED** | Delete psychologist |
| `/api/admin/availability/add-next-day` | POST | ✅ **NEEDED** | Add next day availability |
| `/api/admin/availability/update-all` | POST | ✅ **NEEDED** | Update all availability |
| `/api/admin/psychologists/:psychologistId/packages` | POST | ✅ **NEEDED** | Create psychologist packages |
| `/api/admin/users` | POST | ✅ **NEEDED** | Create user |
| `/api/admin/users/:userId` | PUT | ✅ **NEEDED** | Update user |
| `/api/admin/users/:userId` | DELETE | ✅ **NEEDED** | Delete user |
| `/api/admin/sessions/:sessionId/reschedule` | PUT | ✅ **NEEDED** | Reschedule session |
| `/api/admin/psychologists/:psychologistId/availability` | GET | ✅ **NEEDED** | Get availability for reschedule |
| `/api/admin/bookings/manual` | POST | ✅ **NEEDED** | Create manual booking |
| `/api/admin/reschedule-requests/:notificationId` | PUT | ✅ **NEEDED** | Handle reschedule request |
| `/api/admin/reschedule-requests` | GET | ✅ **NEEDED** | Get reschedule requests |
| `/api/admin/reschedule-requests/assessment/:notificationId/approve` | PUT | ✅ **NEEDED** | Approve assessment reschedule |
| `/api/admin/assessment-sessions/:assessmentSessionId/reschedule` | PUT | ✅ **NEEDED** | Reschedule assessment session |
| `/api/admin/assessment-sessions/:assessmentSessionId` | DELETE | ✅ **NEEDED** | Delete assessment session |
| `/api/admin/psychologists/:psychologistId/calendar-events` | GET | ✅ **NEEDED** | Get calendar events |
| `/api/admin/psychologists/:psychologistId/calendar-sync-status` | GET | ✅ **NEEDED** | Check calendar sync status |
| `/api/admin/trigger-session-reminders` | POST | ⚠️ **CONDITIONAL** | Manual trigger - useful for testing |
| `/api/admin/trigger-calendar-conflict-check` | POST | ⚠️ **CONDITIONAL** | Manual trigger - useful for testing |
| `/api/admin/upload/image` | POST | ✅ **NEEDED** | Upload image |

---

## 🔒 **Security Routes** (`/api/security`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/security/test` | GET | ❌ **NOT NEEDED** | Test endpoint - remove in production |
| `/api/security/alerts` | GET | ✅ **NEEDED** | Get security alerts |
| `/api/security/stats` | GET | ✅ **NEEDED** | Get security stats |
| `/api/security/alerts/:alertId/acknowledge` | POST | ✅ **NEEDED** | Acknowledge alert |
| `/api/security/status` | GET | ✅ **NEEDED** | Get security status |
| `/api/security/settings` | POST | ✅ **NEEDED** | Update security settings |
| `/api/security/bot-detection` | GET | ✅ **NEEDED** | Get bot detection data |
| `/api/security/trends` | GET | ✅ **NEEDED** | Get security trends |
| `/api/security/export` | GET | ✅ **NEEDED** | Export security data |

---

## 👑 **Superadmin Routes** (`/api/superadmin`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/api/superadmin/create-admin` | POST | ✅ **NEEDED** | Create admin user |
| `/api/superadmin/users/:userId` | DELETE | ✅ **NEEDED** | Delete user (superadmin only) |
| `/api/superadmin/analytics/platform` | GET | ✅ **NEEDED** | Get platform analytics |
| `/api/superadmin/maintenance` | POST | ✅ **NEEDED** | System maintenance |
| `/api/superadmin/logs/system` | GET | ✅ **NEEDED** | Get system logs |

---

## 🏥 **Server-Level Endpoints** (Direct on `/`)

| Endpoint | Method | Classification | Notes |
|----------|--------|----------------|-------|
| `/health` | GET | ✅ **NEEDED** | Health check |
| `/api/security/status` | GET | ✅ **NEEDED** | Security status |
| `/api/test-oauth-meet` | POST | ❌ **NOT NEEDED** | Test endpoint - remove in production |
| `/api/test-oauth-local` | POST | ❌ **NOT NEEDED** | Test endpoint - remove in production |
| `/api/oauth2/callback` | GET | ⚠️ **CONDITIONAL** | OAuth callback - may be needed if not in routes |
| `/api/test/create-psychologist` | POST | ❌ **NOT NEEDED** | Test endpoint - remove in production |
| `/api/test/create-client` | POST | ❌ **NOT NEEDED** | Test endpoint - remove in production |

---

## 📊 **Summary**

### ✅ **NEEDED Endpoints**: ~180+
- All core functionality endpoints
- Authentication, booking, payments, sessions
- Admin management, notifications
- Content management (blogs, assessments, counselling)

### ⚠️ **CONDITIONAL Endpoints**: ~5
- Manual trigger endpoints (useful for testing/debugging)
- Diagnostic endpoints (useful for troubleshooting)
- Cleanup endpoints (use with caution)

### ❌ **NOT NEEDED Endpoints**: ~8
- Test endpoints (`/api/test-*`)
- Test OAuth endpoints
- Test blog creation
- Test free assessment endpoints

---

## 🧹 **Recommendations**

1. **Remove Test Endpoints**:
   - `/api/test-oauth-meet`
   - `/api/test-oauth-local`
   - `/api/test/create-psychologist`
   - `/api/test/create-client`
   - `/api/blogs/test/create-dummy`
   - `/api/free-assessments/test-timeslots`
   - `/api/free-assessments/test-date-configs`
   - `/api/security/test`

2. **Consider Removing or Securing**:
   - Manual trigger endpoints (keep but add rate limiting)
   - Diagnostic endpoints (keep but restrict to admin only)

3. **Keep All Core Functionality**:
   - All authentication, booking, payment endpoints
   - All admin management endpoints
   - All content management endpoints

---

**Last Updated**: December 17, 2025
