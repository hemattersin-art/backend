const express = require('express');
const availabilityService = require('../utils/availabilityCalendarService');
const calendarSyncService = require('../services/calendarSyncService');
const { successResponse, errorResponse } = require('../utils/helpers');
const router = express.Router();

/**
 * GET /api/availability/psychologist/:id
 * Get psychologist availability for a specific date
 */
router.get('/psychologist/:id', async (req, res, next) => {
  try {
    const { id: psychologistId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json(
        errorResponse('Date parameter is required (YYYY-MM-DD format)')
      );
    }

    console.log(`📅 Getting availability for psychologist ${psychologistId} on ${date}`);

    const availability = await availabilityService.getPsychologistAvailability(psychologistId, date);

    // Set cache headers (2 minutes browser cache, 5 minutes CDN)
    res.set({
      'Cache-Control': 'public, max-age=120, s-maxage=300',
      'ETag': `"availability-${psychologistId}-${date}"`
    });

    res.json(
      successResponse({
        message: 'Availability retrieved successfully',
        data: availability
      })
    );

  } catch (error) {
    console.error('Error getting psychologist availability:', error);
    next(error);
  }
});

/**
 * GET /api/availability/psychologist/:id/range
 * Get psychologist availability for a date range
 * Optional: ?sync=1 will run a Google Calendar sync for this psychologist
 *           before computing availability, so external events are blocked in real-time.
 * NOTE: Use ?sync=1 sparingly (e.g. therapist profile page) as it triggers
 *       a Google Calendar API call and DB updates.
 */
router.get('/psychologist/:id/range', async (req, res, next) => {
  try {
    const { id: psychologistId } = req.params;
    const { startDate, endDate, sync } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Both startDate and endDate parameters are required (YYYY-MM-DD format)')
      );
    }

    // Optionally run a real-time Google Calendar sync for this psychologist
    // when ?sync=1 or ?sync=true is passed (used by therapist profile page).
    if (sync === '1' || sync === 'true') {
      try {
        console.log(`🔄 Running on-demand calendar sync for psychologist ${psychologistId} before availability range fetch`);
        await calendarSyncService.syncPsychologistById(psychologistId);
      } catch (syncError) {
        console.error(`⚠️ On-demand calendar sync failed for psychologist ${psychologistId}:`, syncError.message || syncError);
        // Do not fail the request if sync fails; fall back to last known DB state
      }
    }

    console.log(`📅 Getting availability range for psychologist ${psychologistId} from ${startDate} to ${endDate}`);

    const availability = await availabilityService.getPsychologistAvailabilityRange(
      psychologistId, 
      startDate, 
      endDate
    );

    // Set cache headers (2 minutes browser cache, 5 minutes CDN)
    res.set({
      'Cache-Control': 'public, max-age=120, s-maxage=300',
      'ETag': `"availability-range-${psychologistId}-${startDate}-${endDate}"`
    });

    res.json(
      successResponse({
        message: 'Availability range retrieved successfully',
        data: availability
      })
    );

  } catch (error) {
    console.error('Error getting psychologist availability range:', error);
    next(error);
  }
});

/**
 * GET /api/availability/psychologist/:id/check
 * Check if a specific time slot is available
 */
router.get('/psychologist/:id/check', async (req, res, next) => {
  try {
    const { id: psychologistId } = req.params;
    const { date, time } = req.query;

    if (!date || !time) {
      return res.status(400).json(
        errorResponse('Both date and time parameters are required')
      );
    }

    console.log(`🔍 Checking availability for psychologist ${psychologistId} on ${date} at ${time}`);

    const isAvailable = await availabilityService.isTimeSlotAvailable(psychologistId, date, time);

    // Set cache headers (1 minute browser cache, 2 minutes CDN)
    res.set({
      'Cache-Control': 'public, max-age=60, s-maxage=120',
      'ETag': `"availability-check-${psychologistId}-${date}-${time}"`
    });

    res.json(
      successResponse({
        message: 'Time slot availability checked successfully',
        data: {
          psychologistId,
          date,
          time,
          isAvailable
        }
      })
    );

  } catch (error) {
    console.error('Error checking time slot availability:', error);
    next(error);
  }
});

/**
 * GET /api/availability/psychologist/:id/working-hours
 * Get psychologist working hours and preferences
 */
router.get('/psychologist/:id/working-hours', async (req, res, next) => {
  try {
    const { id: psychologistId } = req.params;

    console.log(`🕐 Getting working hours for psychologist ${psychologistId}`);

    const workingHours = await availabilityService.getPsychologistWorkingHours(psychologistId);

    res.json(
      successResponse({
        message: 'Working hours retrieved successfully',
        data: workingHours
      })
    );

  } catch (error) {
    console.error('Error getting psychologist working hours:', error);
    next(error);
  }
});

/**
 * GET /api/availability/public/psychologist/:id
 * Public endpoint to get psychologist availability (no authentication required)
 */
router.get('/public/psychologist/:id', async (req, res, next) => {
  try {
    const { id: psychologistId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json(
        errorResponse('Date parameter is required (YYYY-MM-DD format)')
      );
    }

    console.log(`📅 Getting public availability for psychologist ${psychologistId} on ${date}`);

    const availability = await availabilityService.getPsychologistAvailability(psychologistId, date);

    // Filter out sensitive information for public access
    const publicAvailability = {
      date: availability.date,
      psychologistId: availability.psychologistId,
      timeSlots: availability.timeSlots.map(slot => ({
        time: slot.time,
        available: slot.available,
        displayTime: slot.displayTime,
        reason: slot.available ? null : slot.reason
      })),
      totalSlots: availability.totalSlots,
      availableSlots: availability.availableSlots,
      blockedSlots: availability.blockedSlots
    };

    // Set cache headers (2 minutes browser cache, 5 minutes CDN)
    res.set({
      'Cache-Control': 'public, max-age=120, s-maxage=300',
      'ETag': `"public-availability-${psychologistId}-${date}"`
    });

    res.json(
      successResponse({
        message: 'Public availability retrieved successfully',
        data: publicAvailability
      })
    );

  } catch (error) {
    console.error('Error getting public availability:', error);
    next(error);
  }
});

module.exports = router;
