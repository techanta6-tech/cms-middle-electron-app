const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { getCMSBackendURL } = require('../config');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRETKEY || '12345';
/**
 * @route POST /api/v1/login
 * @description Validates credentials against .env or proxies to CMS Backend.
 */
router.post('/api/v1/login', async (req, res) => {
  const { email, password } = req.body;

  // 1. Kiểm tra với tài khoản Admin nội bộ (.env)
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cms.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
  if (email === adminEmail && password === adminPass) {
    const accessToken = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '365d' });
    return res.status(201).send({ success: true, data: { accessToken } });
  }


  // 2. Nếu không phải admin, proxy tới CMS Backend (nếu có)
  const CMS_BE_URL = getCMSBackendURL();
  if (CMS_BE_URL) {
    try {
      const response = await axios.post(`${CMS_BE_URL}/api/v1/login`, req.body);
      return res.status(response.status).send(response.data);
    } catch (err) {
      console.error('[AUTH_PROXY_ERROR]', err.message);
    }
  }

  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

module.exports = router;

