/**
 * Password Policy Validation
 * 
 * Enforces strong password requirements to prevent weak passwords.
 */

// Common weak passwords to blacklist
const COMMON_PASSWORDS = [
  'password', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'abc123', 'monkey', '1234567', 'letmein', 'trustno1',
  'dragon', 'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
  'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
  'qazwsx', 'michael', 'football', 'welcome', 'jesus', 'ninja',
  'mustang', 'password1', '1234567890', 'adobe123', 'admin', 'root'
];

/**
 * Validate password against policy
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }

  // Minimum length: 8 characters
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Maximum length: 128 characters (prevent DoS)
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  // Require uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Require lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Require number
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Require special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*...)');
  }

  // Check against common passwords
  const passwordLower = password.toLowerCase();
  if (COMMON_PASSWORDS.includes(passwordLower)) {
    errors.push('Password is too common. Please choose a more unique password');
  }

  // Check for repeated characters (e.g., "aaaaaa")
  if (/(.)\1{3,}/.test(password)) {
    errors.push('Password contains too many repeated characters');
  }

  // Check for sequential characters (e.g., "12345", "abcde")
  if (/01234|12345|23456|34567|45678|56789|abcdef|bcdefg|cdefgh|defghi|efghij|fghijk|ghijkl|hijklm|ijklmn|jklmno|klmnop|lmnopq|mnopqr|nopqrs|opqrst|pqrstu|qrstuv|rstuvw|stuvwx|tuvwxy|uvwxyz/i.test(password)) {
    errors.push('Password contains sequential characters');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Get password strength score (0-100)
 * @param {string} password - Password to score
 * @returns {number} - Strength score (0-100)
 */
function getPasswordStrength(password) {
  if (!password) return 0;

  let score = 0;

  // Length bonus (max 25 points)
  if (password.length >= 8) score += 10;
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 5;

  // Character variety (max 40 points)
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 10;
  if (/[^a-zA-Z0-9]/.test(password)) score += 10;

  // Complexity bonus (max 20 points)
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= password.length * 0.5) score += 10;
  if (uniqueChars >= password.length * 0.7) score += 10;

  // Penalties
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) score -= 50;
  if (/(.)\1{3,}/.test(password)) score -= 20;
  if (/01234|12345|abcdef|qwerty/i.test(password)) score -= 30;

  return Math.max(0, Math.min(100, score));
}

module.exports = {
  validatePassword,
  getPasswordStrength,
  COMMON_PASSWORDS
};

