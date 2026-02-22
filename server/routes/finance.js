/**
 * 财务路由 - 充值/提现（完整版）
 * 仅保留：POST /deposit, GET /deposits, POST /withdrawal, GET /withdrawals（无 /admin/* 接口）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { success, error } = require('../utils/response');

const router = express.Router();

// 充值截图上传目录（放在 public 下以便前端直接访问）
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/deposits');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname).toLowerCase()) || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 10) + safeExt);
  }
});
const uploadScreenshot = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Only images (JPEG/PNG/GIF/WebP) are allowed'), ok);
  }
});

/**
 * 上传充值截图（登录用户）
 * POST /api/finance/upload-screenshot
 * body: multipart/form-data, field name: screenshot
 */
router.post('/upload-screenshot', authenticate, uploadScreenshot.single('screenshot'), (req, res) => {
  if (!req.file) {
    return error(res, 'No image file uploaded');
  }
  const url = '/public/uploads/deposits/' + req.file.filename;
  return success(res, { url }, 'Upload success');
}, (err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return error(res, 'Image size must be under 5MB');
  }
  return error(res, err.message || 'Upload failed');
});

function getSettings(db, keys) {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  const o = {};
  rows.forEach(r => { o[r.key] = r.value; });
  return o;
}

/**
 * 提交充值申请（按后台配置校验）
 * POST /api/finance/deposit
 */
router.post('/deposit', authenticate, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const { amount, hash, screenshot_url, note, channel_id } = req.body;

  try {
    const cfg = getSettings(db, ['deposit_maintenance', 'deposit_min_amount', 'deposit_require_hash_or_screenshot', 'deposit_daily_limit']);
    if (cfg.deposit_maintenance === '1') {
      return error(res, 'Deposit is under maintenance');
    }

    const amt = parseFloat(amount);
    if (!amount || amt <= 0) {
      return error(res, 'Amount must be greater than 0');
    }

    const minAmt = parseFloat(cfg.deposit_min_amount);
    if (!isNaN(minAmt) && minAmt > 0 && amt < minAmt) {
      return error(res, `Minimum deposit is ${minAmt} USDT`);
    }

    const requireHash = cfg.deposit_require_hash_or_screenshot !== '0';
    if (requireHash && !hash && !screenshot_url) {
      return error(res, 'Please provide transaction hash or upload screenshot');
    }

    const dailyLimit = parseFloat(cfg.deposit_daily_limit);
    if (!isNaN(dailyLimit) && dailyLimit > 0) {
      const today = db.prepare(
        "SELECT COALESCE(SUM(amount),0) as total FROM deposits WHERE user_id = ? AND date(created_at) = date('now') AND status IN ('pending','approved')"
      ).get(userId);
      if (today && today.total + amt > dailyLimit) {
        return error(res, `Daily deposit limit is ${dailyLimit} USDT`);
      }
    }

    const result = db.prepare(`
      INSERT INTO deposits (user_id, amount, hash, screenshot_url, note, channel_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `).run(userId, amt, hash || null, screenshot_url || null, note || null, channel_id || null);

    return success(res, {
      deposit_id: result.lastInsertRowid,
      amount: amt,
      status: 'pending'
    }, 'Deposit request submitted, please wait for approval');
  } catch (err) {
    console.error('Deposit Error:', err);
    return error(res, err.message || 'Failed to submit deposit request');
  }
});

/**
 * 获取我的充值记录
 * GET /api/finance/deposits
 */
router.get('/deposits', authenticate, (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  try {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const deposits = db.prepare(`
      SELECT
        id, amount, hash, screenshot_url, status, note,
        created_at, reviewed_at
      FROM deposits
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limitNum, offset);

    const totalRow = db.prepare(
      'SELECT COUNT(*) as count FROM deposits WHERE user_id = ?'
    ).get(userId);
    const total = totalRow ? totalRow.count : 0;

    return success(res, {
      deposits,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    console.error('Get Deposits Error:', err);
    return error(res, 'Failed to get deposit records');
  }
});

/**
 * 提交提现申请（按后台配置：限额、手续费、单日限制）
 * POST /api/finance/withdrawal
 */
router.post('/withdrawal', authenticate, (req, res) => {
  const { amount, wallet_address, password, note, channel_id } = req.body;
  const db = req.db;

  if (!amount || parseFloat(amount) <= 0) {
    return error(res, 'Invalid amount');
  }
  if (!wallet_address) {
    return error(res, 'Wallet address is required');
  }

  try {
    const cfg = getSettings(db, ['withdraw_open', 'withdraw_maintenance', 'withdraw_min', 'withdraw_max', 'withdraw_fee_type', 'withdraw_fee_value', 'withdraw_daily_count_limit', 'withdraw_daily_amount_limit']);
    if (cfg.withdraw_open === '0') {
      return error(res, 'Withdrawal is currently disabled');
    }
    if (cfg.withdraw_maintenance === '1') {
      return error(res, 'Withdrawal is under maintenance');
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.status !== 'active') {
      return error(res, 'Account is frozen. Withdrawal is not allowed.');
    }
    if (user.allow_withdraw === 0 || user.allow_withdraw === false) {
      return error(res, 'Withdrawal is disabled. Please contact support.');
    }
    if (user.account_lock_status === 'locked_chain') {
      return error(res, 'You have uncompleted chain orders. Please complete them before withdrawing.');
    }

    const amt = parseFloat(amount);
    const minW = parseFloat(cfg.withdraw_min);
    const maxW = parseFloat(cfg.withdraw_max);
    const minWithdrawal = (!isNaN(minW) && minW >= 0) ? minW : 10;
    if (amt < minWithdrawal) {
      return error(res, `Minimum withdrawal is ${minWithdrawal} USDT`);
    }
    if (!isNaN(maxW) && maxW > 0 && amt > maxW) {
      return error(res, `Maximum withdrawal is ${maxW} USDT`);
    }

    let fee = 0;
    const feeType = (cfg.withdraw_fee_type || 'percent').toLowerCase();
    const feeVal = parseFloat(cfg.withdraw_fee_value || 0);
    if (!isNaN(feeVal) && feeVal > 0) {
      fee = feeType === 'fixed' ? feeVal : (amt * feeVal / 100);
    }
    const totalDeduct = amt + fee;

    if (user.balance < totalDeduct) {
      return error(res, `Insufficient balance (need ${totalDeduct.toFixed(2)} USDT including fee)`);
    }

    const countLimit = parseInt(cfg.withdraw_daily_count_limit, 10) || 0;
    const amountLimit = parseFloat(cfg.withdraw_daily_amount_limit) || 0;
    if (countLimit > 0 || amountLimit > 0) {
      const today = db.prepare(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM withdrawals WHERE user_id = ? AND date(created_at) = date('now') AND status IN ('pending','approved','paid')"
      ).get(req.user.id);
      if (countLimit > 0 && today.cnt >= countLimit) {
        return error(res, 'Daily withdrawal count limit reached');
      }
      if (amountLimit > 0 && today.total + amt > amountLimit) {
        return error(res, `Daily withdrawal amount limit is ${amountLimit} USDT`);
      }
    }

    if (user.security_password) {
      if (!password) return error(res, 'Please enter your security password');
      if (!bcrypt.compareSync(password, user.security_password)) {
        return error(res, 'Incorrect security password');
      }
    }

    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalDeduct, req.user.id);
    const result = db.prepare(
      'INSERT INTO withdrawals (user_id, amount, wallet_address, note, channel_id, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, amt, wallet_address, note || null, channel_id || null, 'pending');
    db.prepare(
      'INSERT INTO ledger (user_id, type, amount, order_no, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, 'withdrawal_pending', -totalDeduct, `WD${result.lastInsertRowid}`, 'Withdrawal submitted', req.user.id);
    
    return success(res, {
      withdrawal_id: result.lastInsertRowid,
      amount: amt,
      fee,
      wallet_address,
      status: 'pending'
    }, 'Withdrawal request submitted');
    
  } catch (err) {
    console.error('提现申请失败:', err);
    return error(res, 'Withdrawal request failed. Please try again later.');
  }
});

/**
 * 获取我的提现记录
 * GET /api/finance/withdrawals
 */
router.get('/withdrawals', authenticate, (req, res) => {
  const withdrawals = req.db.prepare(
    'SELECT id, amount, wallet_address, status, note, payout_ref, created_at, reviewed_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  
  return success(res, withdrawals);
});

module.exports = router;
