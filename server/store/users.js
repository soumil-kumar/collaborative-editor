const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const SALT_ROUNDS = 10;

// In-memory user store: username -> { userId, passwordHash }
const users = new Map();

/**
 * Registers a new user. Throws if username already taken.
 * Returns { userId, username }.
 */
async function registerUser(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }
  if (username.length < 3 || username.length > 20) {
    throw new Error('Username must be between 3 and 20 characters');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  if (users.has(username)) {
    throw new Error('Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = uuidv4();
  users.set(username, { userId, passwordHash });

  return { userId, username };
}

/**
 * Validates credentials. Throws if invalid.
 * Returns { userId, username }.
 */
async function validateUser(username, password) {
  const user = users.get(username);
  if (!user) {
    throw new Error('Invalid username or password');
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    throw new Error('Invalid username or password');
  }
  return { userId: user.userId, username };
}

module.exports = { registerUser, validateUser };
