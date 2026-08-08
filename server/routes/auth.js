const express = require('express');
const router = express.Router();
const { registerUser, validateUser } = require('../store/users');
const { signToken } = require('../middleware/auth');

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await registerUser(username, password);
    const token = signToken({ userId: user.userId, username: user.username });
    res.status(201).json({ token, username: user.username, userId: user.userId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await validateUser(username, password);
    const token = signToken({ userId: user.userId, username: user.username });
    res.status(200).json({ token, username: user.username, userId: user.userId });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
