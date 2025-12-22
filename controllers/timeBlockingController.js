const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const timeBlockingService = require('../utils/timeBlockingService');

// Block time slots
const blockTimeSlots = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { type, date, startDate, endDate, timeSlots, reason } = req.body;

    console.log('🚫 Blocking request received:', {
      psychologistId,
      type,
      date,
      startDate,
      endDate,
      timeSlots,
      reason
    });

    // Validate required fields based on blocking type
    if (!type) {
      return res.status(400).json(
        errorResponse('Blocking type is required')
      );
    }

    let blockingData = { type, reason };

    switch (type) {
      case 'whole_day':
        if (!date) {
          return res.status(400).json(
            errorResponse('Date is required for whole day blocking')
          );
        }
        blockingData.date = date;
        break;

      case 'multiple_days':
        if (!startDate || !endDate) {
          return res.status(400).json(
            errorResponse('Start date and end date are required for multiple days blocking')
          );
        }
        blockingData.startDate = startDate;
        blockingData.endDate = endDate;
        break;

      case 'specific_slots':
        if (!date || !timeSlots || !Array.isArray(timeSlots)) {
          return res.status(400).json(
            errorResponse('Date and time slots array are required for specific slots blocking')
          );
        }
        blockingData.date = date;
        blockingData.timeSlots = timeSlots;
        break;

      default:
        return res.status(400).json(
          errorResponse('Invalid blocking type. Must be: whole_day, multiple_days, or specific_slots')
        );
    }

    // Check if psychologist has Google Calendar connected
    const { data: psychologist, error: psychError } = await supabaseAdmin
      .from('psychologists')
      .select('google_calendar_credentials')
      .eq('id', psychologistId)
      .single();

    if (psychError || !psychologist) {
      return res.status(404).json(
        errorResponse('Psychologist not found')
      );
    }

    if (!psychologist.google_calendar_credentials) {
      return res.status(400).json(
        errorResponse('Google Calendar must be connected to block time slots')
      );
    }

    // Block the time slots
    const result = await timeBlockingService.blockTimeSlots(psychologistId, blockingData);

    if (!result.success) {
      return res.status(500).json(
        errorResponse(result.error)
      );
    }

    res.status(200).json(
      successResponse(result.data, 'Time slots blocked successfully')
    );

  } catch (error) {
    console.error('Error blocking time slots:', error);
    res.status(500).json(
      errorResponse('Failed to block time slots')
    );
  }
};

// Unblock time slots
const unblockTimeSlots = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { eventIds } = req.body;

    if (!eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json(
        errorResponse('Event IDs array is required')
      );
    }

    const result = await timeBlockingService.unblockTimeSlots(psychologistId, { eventIds });

    if (!result.success) {
      return res.status(500).json(
        errorResponse(result.error)
      );
    }

    res.status(200).json(
      successResponse(result.data, 'Time slots unblocked successfully')
    );

  } catch (error) {
    console.error('Error unblocking time slots:', error);
    res.status(500).json(
      errorResponse('Failed to unblock time slots')
    );
  }
};

// Get blocked time slots
const getBlockedTimeSlots = async (req, res) => {
  try {
    const psychologistId = req.user.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json(
        errorResponse('Start date and end date are required')
      );
    }

    const result = await timeBlockingService.getBlockedTimeSlots(psychologistId, startDate, endDate);

    if (!result.success) {
      return res.status(500).json(
        errorResponse(result.error)
      );
    }

    res.status(200).json(
      successResponse(result.data, 'Blocked time slots retrieved successfully')
    );

  } catch (error) {
    console.error('Error getting blocked time slots:', error);
    res.status(500).json(
      errorResponse('Failed to get blocked time slots')
    );
  }
};

module.exports = {
  blockTimeSlots,
  unblockTimeSlots,
  getBlockedTimeSlots
};
