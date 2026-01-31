/**
 * Helper for psychologist recurring availability blocks (e.g. block every Sunday).
 * Used when returning availability so blocked slots are excluded per psychologist.
 */

const { supabaseAdmin } = require('../config/supabase');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get day of week from date string (YYYY-MM-DD). 0 = Sunday, 6 = Saturday (JavaScript convention).
 */
function getDayOfWeekFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay();
}

/**
 * Normalize time slot for comparison (HH:MM or HH:MM:SS -> HH:MM).
 */
function normalizeSlotTime(slot) {
  if (!slot) return null;
  const s = String(slot).trim();
  const match = s.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = match[1].padStart(2, '0');
  const m = match[2];
  return `${h}:${m}`;
}

/**
 * Check if a time slot is blocked by recurring blocks for a given day of week.
 * @param {Array} recurringBlocks - From getRecurringBlocksForPsychologist
 * @param {number} dayOfWeek - 0-6 (Sunday-Saturday)
 * @param {string} timeSlot - e.g. "09:00" or "09:00:00"
 * @returns {boolean}
 */
function isSlotBlockedByRecurring(recurringBlocks, dayOfWeek, timeSlot) {
  if (!recurringBlocks || recurringBlocks.length === 0) return false;
  const block = recurringBlocks.find(b => b.day_of_week === dayOfWeek);
  if (!block) return false;
  if (block.block_entire_day) return true;
  const slots = block.time_slots || [];
  const normalized = normalizeSlotTime(timeSlot);
  if (!normalized) return false;
  return slots.some(s => normalizeSlotTime(s) === normalized);
}

/**
 * Fetch recurring blocks for a psychologist.
 * @param {string} psychologistId
 * @returns {Promise<Array>}
 */
async function getRecurringBlocksForPsychologist(psychologistId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('psychologist_recurring_blocks')
      .select('*')
      .eq('psychologist_id', psychologistId);

    if (error) {
      // Table may not exist yet (migration not run)
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return [];
      }
      console.error('Error fetching recurring blocks:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Error fetching recurring blocks:', err);
    return [];
  }
}

/**
 * Filter availability time_slots for a single day by recurring blocks.
 * @param {Array<string>} timeSlots - e.g. ["09:00", "10:00", ...]
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Array} recurringBlocks - From getRecurringBlocksForPsychologist
 * @returns {Array<string>} Filtered slots (excluding blocked)
 */
function filterSlotsByRecurringBlocks(timeSlots, dateStr, recurringBlocks) {
  if (!timeSlots || timeSlots.length === 0) return [];
  if (!recurringBlocks || recurringBlocks.length === 0) return timeSlots;

  const dayOfWeek = getDayOfWeekFromDate(dateStr);
  if (dayOfWeek == null) return timeSlots;

  return timeSlots.filter(slot => !isSlotBlockedByRecurring(recurringBlocks, dayOfWeek, slot));
}

/**
 * Get day name for display (0 -> "Sunday", etc.).
 */
function getDayName(dayOfWeek) {
  return DAYS[dayOfWeek] ?? '';
}

module.exports = {
  getDayOfWeekFromDate,
  normalizeSlotTime,
  isSlotBlockedByRecurring,
  getRecurringBlocksForPsychologist,
  filterSlotsByRecurringBlocks,
  getDayName,
  DAYS
};
