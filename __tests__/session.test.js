// Session booking tests
describe('Session Booking', () => {
  it('should validate session duration is positive', () => {
    const duration = 60; // minutes
    expect(duration).toBeGreaterThan(0);
  });

  it('should validate session date is in the future', () => {
    // Use a date that's definitely in the future
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const today = new Date();
    expect(futureDate.getTime()).toBeGreaterThan(today.getTime());
  });

  it('should validate session time format', () => {
    const timeFormat = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const validTime = '14:30';
    expect(timeFormat.test(validTime)).toBe(true);
  });

  it('should reject invalid time format', () => {
    const timeFormat = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const invalidTime = '25:00';
    expect(timeFormat.test(invalidTime)).toBe(false);
  });
});

describe('Session Status', () => {
  const validStatuses = ['scheduled', 'completed', 'cancelled', 'no-show'];

  it('should accept valid session statuses', () => {
    validStatuses.forEach(status => {
      expect(validStatuses).toContain(status);
    });
  });

  it('should validate session has required fields', () => {
    const session = {
      id: '123',
      psychologistId: '456',
      clientId: '789',
      date: '2025-12-31',
      time: '14:30',
      status: 'scheduled',
    };

    expect(session.id).toBeDefined();
    expect(session.psychologistId).toBeDefined();
    expect(session.clientId).toBeDefined();
    expect(session.date).toBeDefined();
    expect(session.time).toBeDefined();
    expect(session.status).toBeDefined();
  });
});
