/**
 * JWT 工具函数
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
