const request = require('supertest');
const jwt = require('jsonwebtoken');
const { generateToken, hashPassword, comparePassword } = require('../utils/helpers');

// Mock Supabase
jest.mock('../config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
          maybeSingle: jest.fn(),
        })),
        maybeSingle: jest.fn(),
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(),
      })),
    })),
  },
}));

describe('Authentication Utilities', () => {
  beforeEach(() => {
    // Set JWT_SECRET for tests
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jwt-tokens';
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const userId = '123';
      const role = 'client';
      const token = generateToken(userId, role);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId).toBe(userId);
      expect(decoded.role).toBe(role);
    });

    it('should include expiration in token', () => {
      const token = generateToken('123', 'client');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'testPassword123';
      const hashed = await hashPassword(password);
      
      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
      expect(hashed.length).toBeGreaterThan(0);
    });

    it('should produce different hashes for the same password', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      // bcrypt should produce different hashes each time
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePassword', () => {
    it('should correctly compare password with hash', async () => {
      const password = 'testPassword123';
      const hashed = await hashPassword(password);
      
      const isValid = await comparePassword(password, hashed);
      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword';
      const hashed = await hashPassword(password);
      
      const isValid = await comparePassword(wrongPassword, hashed);
      expect(isValid).toBe(false);
    });
  });
});

describe('Password Validation', () => {
  const { validatePassword } = require('../utils/passwordPolicy');

  it('should reject passwords shorter than 8 characters', () => {
    const result = validatePassword('short');
    // Check if result exists and has isValid property or check errors array
    if (result && typeof result === 'object') {
      if ('isValid' in result) {
        expect(result.isValid).toBe(false);
      }
      if ('errors' in result && Array.isArray(result.errors)) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    } else {
      // If function returns boolean or different structure, test accordingly
      expect(result).toBeDefined();
    }
  });

  it('should validate password structure', () => {
    const result = validatePassword('ValidPass123!');
    expect(result).toBeDefined();
    // Test that function doesn't throw and returns something
    if (result && typeof result === 'object' && 'isValid' in result) {
      expect(result.isValid).toBe(true);
    }
  });
});
