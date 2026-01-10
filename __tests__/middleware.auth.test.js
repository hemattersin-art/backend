const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');

// Mock dependencies
jest.mock('../config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
        })),
      })),
    })),
  },
}));

jest.mock('../utils/tokenRevocation', () => ({
  isTokenRevoked: jest.fn(() => Promise.resolve(false)),
}));

// Set environment variables before requiring auth middleware
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

describe('Authentication Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      method: 'GET',
      url: '/api/test',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    process.env.JWT_SECRET = 'test-secret-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if no token is provided', async () => {
    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Access denied',
      message: 'No token provided',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if token is invalid', async () => {
    req.headers.authorization = 'Bearer invalid-token';

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() if token is valid', async () => {
    const userId = '123';
    const role = 'client';
    const token = jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(userId);
    expect(req.user.role).toBe(role);
  });

  it('should return 401 if token is revoked', async () => {
    const tokenRevocationService = require('../utils/tokenRevocation');
    tokenRevocationService.isTokenRevoked.mockResolvedValueOnce(true);

    const token = jwt.sign({ userId: '123', role: 'client' }, process.env.JWT_SECRET);
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Access denied',
      message: 'Token has been revoked',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle expired tokens', async () => {
    const expiredToken = jwt.sign(
      { userId: '123', role: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '-1h' }
    );
    req.headers.authorization = `Bearer ${expiredToken}`;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
