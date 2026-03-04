/**
 * 任务路由 - 抢单逻辑（统一 match + confirm）
 *
 * 主流程（抢单页 grab.html）:
 *   POST /api/task/match   → 匹配订单，创建 pending，不扣款，返回 match_token
 *   POST /api/task/confirm → 用户确认后扣款并立即返还本金+佣金
 *
 * 历史完成（History / dashboard 的「Complete Task」）:
 *   POST /api/task/submit  → 根据 order.source：match=扣款+返还，start/legacy=解冻+返还
 *
 * 已废弃（请勿使用）:
 *   POST /api/task/start   → 旧版一步扣款冻结，已废弃，统一走 match+confirm
 * 已移除（旧任务系统）: POST /:id/claim、POST /:id/complete，不再提供
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { getDb } = require('../db');
const { success, error } = require('../utils/response');

const router = express.Router();

/**
 * 三级团队返佣：仅当订单已完成并给当前用户发放佣金后，在同一个事务内调用。
 * 通过 referred_by 向上追溯一级、二级、三级推荐人（含 Agent），按配置比例发放奖励并记流水。
 * @param {object} db - 数据库实例（当前事务内）
 * @param {number} refereeUserId - 完成订单的用户 ID（下级）
 * @param {number} orderCommission - 该单给下级的佣金金额
 * @param {string} orderNo - 订单号
 */
function distributeTeamCommission(db, refereeUserId, orderCommission, orderNo) {
  const referee = db.prepare('SELECT username, referred_by FROM users WHERE id = ?').get(refereeUserId);
  if (!referee || !referee.referred_by) return;
  const refereeName = referee.username || ('用户' + refereeUserId);
  const r1 = db.prepare("SELECT value FROM settings WHERE key = 'level_1_commission_rate'").get();
  const r2 = db.prepare("SELECT value FROM settings WHERE key = 'level_2_commission_rate'").get();
  const r3 = db.prepare("SELECT value FROM settings WHERE key = 'level_3_commission_rate'").get();
  const rate1 = (r1 && r1.value != null) ? parseFloat(r1.value) / 100 : 0.15;
  const rate2 = (r2 && r2.value != null) ? parseFloat(r2.value) / 100 : 0.10;
  const rate3 = (r3 && r3.value != null) ? parseFloat(r3.value) / 100 : 0.05;
  const rates = [rate1, rate2, rate3];
  let currentInviteCode = referee.referred_by;
  for (let level = 0; level < 3; level++) {
    const referrer = db.prepare('SELECT id, username, referred_by FROM users WHERE invite_code = ?').get(currentInviteCode);
    if (!referrer) break;
    const rate = rates[level];
    const amount = parseFloat((orderCommission * rate).toFixed(4));
    if (amount > 0) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, referrer.id);
      const desc = '来自下级 ' + refereeName + ' 的订单返利';
      try {
        db.prepare("INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, 'team_commission', ?, ?, datetime('now'))").run(referrer.id, amount, desc);
      } catch (e) {}
      try {
        db.prepare("INSERT INTO ledger (user_id, type, amount, order_no, reason, created_by, created_at) VALUES (?, 'team_commission', ?, ?, ?, ?, datetime('now'))").run(referrer.id, amount, orderNo || '', desc, referrer.id);
      } catch (e2) {}
    }
    currentInviteCode = referrer.referred_by;
    if (!currentInviteCode) break;
  }
}

// 抢单确认限流：每 IP 每分钟最多 30 次，防刷单
const confirmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: '操作过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

// 匹配缓存：match_token -> { userId, orderNo, amount, commission, totalReturn, commissionRate }，5分钟过期
const matchCache = new Map();
const MATCH_TTL = 5 * 60 * 1000; // 5分钟

function cleanupMatchCache() {
    const now = Date.now();
    for (const [k, v] of matchCache.entries()) {
        if (now - (v.ts || 0) > MATCH_TTL) matchCache.delete(k);
    }
}
setInterval(cleanupMatchCache, 60000);

function pickUniversalProduct(db, { maxUnitPrice } = {}) {
    try {
        const where = [];
        const params = [];
        // 全员通用：vip_level=0 或 NULL
        where.push('(vip_level = 0 OR vip_level IS NULL)');
        if (maxUnitPrice != null && isFinite(maxUnitPrice)) {
            where.push('price IS NOT NULL AND price > 0 AND price <= ?');
            params.push(maxUnitPrice);
        } else {
            where.push('price IS NOT NULL AND price > 0');
        }
        const sql = `
            SELECT id, title, price, image, vip_level
            FROM products
            WHERE ${where.join(' AND ')}
            ORDER BY RANDOM()
            LIMIT 1
        `;
        return db.prepare(sql).get(...params) || null;
    } catch (e) {
        return null;
    }
}

function computeQuantity(targetAmount, unitPrice) {
    const p = Number(unitPrice);
    const t = Number(targetAmount);
    if (!isFinite(p) || p <= 0 || !isFinite(t) || t <= 0) return 1;
    // 目标金额 / 单价 四舍五入
    let q = Math.round(t / p);
    if (!isFinite(q) || q < 1) q = 1;
    // 系统最低 10（兜底）
    const minQ = Math.ceil(10 / p);
    if (isFinite(minQ) && minQ > q) q = minQ;
    // 防止数量异常过大
    if (q > 1000) q = 1000;
    return q;
}

/**
 * 第一步：匹配任务（不扣款、不创建订单）
 * POST /api/task/match
 */
router.post('/match', authenticate, (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    try {
        // 检查是否有未完成订单（来自 /start 流程），避免两套流程冲突
        const pendingOrder = db.prepare('SELECT id FROM orders WHERE user_id = ? AND status = ? LIMIT 1').get(userId, 'pending');
        if (pendingOrder) {
            return res.json({
                success: false,
                message: 'You have an uncompleted order. Please complete it first.',
                code: 'PENDING_ORDER',
                order_id: pendingOrder.id
            });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) return res.json({ success: false, message: 'User not found.' });
        if (user.allow_grab === 0) return res.json({ success: false, message: 'Account grabbing is disabled.' });
        if (user.balance < 10) return res.json({ success: false, message: 'Insufficient balance (Min 10 USDT).' });

        let vipConfig = db.prepare('SELECT * FROM vip_levels WHERE level = ?').get(user.vip_level != null ? user.vip_level : 1);
        if (!vipConfig) vipConfig = { task_limit: 40, commission_rate: 0.005 };
        const dailyOrders = vipConfig.task_limit != null ? vipConfig.task_limit : 40;
        if (user.task_progress >= dailyOrders) {
            return res.json({ success: false, message: 'Daily task limit reached.' });
        }

        const nextOrderIndex = (user.task_progress || 0) + 1;
        const dispatchedOrder = db.prepare(
            'SELECT id, min_amount, max_amount FROM dispatched_orders WHERE user_id = ? AND task_index = ? AND status = ?'
        ).get(userId, nextOrderIndex, 'pending');

        let targetAmount;
        let dispatchOrderId = null;
        let orderType = 'normal';

        if (dispatchedOrder) {
            // 命中派单：金额在 [min_amount,max_amount] 内随机，可超过用户余额，用户需充值后再确认
            const minAmt = Math.max(10, dispatchedOrder.min_amount);
            const maxAmt = Math.max(minAmt, dispatchedOrder.max_amount);
            targetAmount = Math.floor(minAmt + Math.random() * (maxAmt - minAmt + 1));
            if (targetAmount < 10) targetAmount = 10;
            dispatchOrderId = dispatchedOrder.id;
            orderType = 'dispatch';
        }
        if (!dispatchOrderId) {
            const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('match_min_ratio', 'match_max_ratio')").all();
            const setMap = settings.reduce((acc, cur) => ({ ...acc, [cur.key]: cur.value }), {});
            const minRatio = parseFloat(setMap.match_min_ratio) || 0.1;
            const maxRatio = parseFloat(setMap.match_max_ratio) || 0.7;
            targetAmount = Math.floor(user.balance * (Math.random() * (maxRatio - minRatio) + minRatio));
            if (targetAmount < 10) targetAmount = 10;
        }

        // 动态数量匹配：先随机选品（全员通用）-> 再按目标金额计算数量 -> 得出最终订单金额
        const product = pickUniversalProduct(db, { maxUnitPrice: user.balance > 0 ? user.balance : null });
        let unitPrice = null;
        let quantity = null;
        let productTitle = null;
        let productImage = null;
        let productName = null;
        let orderAmount = targetAmount;
        if (product && product.price != null && Number(product.price) > 0) {
            unitPrice = Number(product.price);
            quantity = computeQuantity(targetAmount, unitPrice);
            orderAmount = Number((unitPrice * quantity).toFixed(2));
            productTitle = product.title || '';
            productImage = product.image || null;
            productName = productTitle ? `${productTitle} x ${quantity}` : null;
        }

        const commissionRate = vipConfig.commission_rate != null ? vipConfig.commission_rate : 0.005;
        const commission = parseFloat((orderAmount * commissionRate).toFixed(4));
        const totalReturn = orderAmount + commission;
        const orderNo = 'ORD' + Date.now() + '' + userId;

        const matchToken = 'mt_' + require('crypto').randomBytes(16).toString('hex');

        // match 成功时立即创建 pending 订单，便于 History > Pending 显示
        const insertResult = db.prepare(`
            INSERT INTO orders (
                order_no, user_id, amount, commission, status, type, source, dispatch_order_id,
                product_title, product_image, unit_price, quantity, product_name,
                created_at
            )
            VALUES (
                ?, ?, ?, ?, 'pending', ?, 'match', ?,
                ?, ?, ?, ?, ?,
                datetime('now')
            )
        `).run(
            orderNo, userId, orderAmount, commission, orderType, dispatchOrderId || null,
            productTitle, productImage, unitPrice, quantity, productName
        );

        matchCache.set(matchToken, {
            userId,
            orderId: insertResult.lastInsertRowid,
            orderNo,
            amount: orderAmount,
            commission,
            totalReturn,
            commissionRate,
            dispatchOrderId,
            orderType,
            productName,
            unitPrice,
            quantity,
            ts: Date.now()
        });

        res.json({
            success: true,
            data: {
                match_token: matchToken,
                order_no: orderNo,
                amount: orderAmount,
                product_name: productName,
                product_title: productTitle,
                product_image: productImage,
                unit_price: unitPrice,
                quantity: quantity,
                commission,
                commission_rate: commissionRate,
                total_return: totalReturn
            }
        });
    } catch (err) {
        console.error('Match Error:', err);
        res.status(500).json({ success: false, message: 'Match failed, please try again.' });
    }
});

/**
 * 第二步：确认接单（扣款 + 立即返还本金+佣金）
 * POST /api/task/confirm
 */
router.post('/confirm', confirmLimiter, authenticate, (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { match_token } = req.body;

    if (!match_token) return res.json({ success: false, message: 'Missing match_token.' });

    const cached = matchCache.get(match_token);
    if (!cached || cached.userId !== userId) {
        return res.json({ success: false, message: 'Invalid or expired match. Please try again.' });
    }
    matchCache.delete(match_token);

    const { orderId, orderNo, amount, commission, totalReturn, orderType = 'normal', dispatchOrderId, productName, unitPrice, quantity } = cached;

    try {
        const user = db.prepare('SELECT balance, task_progress, vip_level FROM users WHERE id = ?').get(userId);
        if (!user) return res.json({ success: false, message: 'User not found.' });
        if (user.balance < amount) return res.json({ success: false, message: 'Insufficient balance.' });

        let vipConfig = db.prepare('SELECT task_limit FROM vip_levels WHERE level = ?').get(user.vip_level != null ? user.vip_level : 1);
        if (!vipConfig) vipConfig = { task_limit: 40 };
        const dailyOrders = vipConfig.task_limit != null ? vipConfig.task_limit : 40;
        const newProgress = (user.task_progress || 0) + 1;
        const reachedDailyLimit = newProgress >= dailyOrders;

        db.transaction(() => {
            db.prepare('UPDATE orders SET status = ? WHERE id = ? AND user_id = ? AND status = ?')
                .run('completed', orderId, userId, 'pending');

            db.prepare('UPDATE users SET balance = balance - ? + ?, task_progress = task_progress + 1 WHERE id = ?')
                .run(amount, totalReturn, userId);

            if (reachedDailyLimit) {
                db.prepare('UPDATE users SET allow_grab = 0 WHERE id = ?').run(userId);
            }

            if (dispatchOrderId) {
                db.prepare("UPDATE dispatched_orders SET status = ?, triggered_at = datetime('now') WHERE id = ?")
                    .run('used', dispatchOrderId);
            }

            db.prepare(`
                INSERT INTO ledger (user_id, type, amount, order_no, reason, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(userId, 'task_reward', commission, orderNo, 'Task commission', userId);

            try {
                db.prepare(`
                    INSERT INTO transactions (user_id, type, amount, description, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run(userId, 'task_commission', commission, `Task commission: ${orderNo}`);
            } catch (e) {}
            distributeTeamCommission(db, userId, commission, orderNo);
        })();

        res.json({
            success: true,
            data: {
                order_no: orderNo,
                amount,
                product_name: productName,
                unit_price: unitPrice,
                quantity: quantity,
                commission,
                total_return: totalReturn,
                task_progress: newProgress,
                daily_completed: reachedDailyLimit,
                allow_grab: reachedDailyLimit ? 0 : 1
            },
            message: reachedDailyLimit ? 'Task completed. Daily limit reached; grabbing paused until admin re-enables.' : 'Task completed. Principal + commission returned.'
        });
    } catch (err) {
        console.error('Confirm Error:', err);
        res.status(500).json({ success: false, message: 'Confirm failed, please try again.' });
    }
});

// 已废弃：统一使用 match + confirm
router.post('/start', authenticate, (req, res) => {
    console.warn('[task] Deprecated: POST /api/task/start called. Use /api/task/match then /api/task/confirm.');
    return res.status(410).json({
        success: false,
        message: 'Deprecated. Use POST /api/task/match then POST /api/task/confirm.',
        code: 'USE_MATCH_CONFIRM'
    });
});

/**
 * 提交订单完成（动态佣金版）
 * 用于 Dashboard / History 页的「Complete Task」按钮；与 confirm 不同：confirm 在抢单页确认接单时调用，submit 在用户稍后点击完成任务时调用，不可合并。
 * POST /api/task/submit
 */
router.post('/submit', authenticate, (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { order_id } = req.body;
    
    if (!order_id) {
        return error(res, 'Order ID is required');
    }
    
    try {
        // 1. 获取订单信息
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(order_id, userId);
        
        if (!order) {
            return error(res, 'Order not found', 404);
        }
        
        if (order.status !== 'pending') {
            return error(res, 'Order already processed');
        }

        const orderAmount = order.amount;
        const isMatchFlow = order.source === 'match';

        if (isMatchFlow) {
            const user = db.prepare('SELECT balance, task_progress, vip_level FROM users WHERE id = ?').get(userId);
            if (!user) return error(res, 'User not found', 404);
            if (user.balance < orderAmount) return error(res, 'Insufficient balance');
            const commission = order.commission != null ? order.commission : parseFloat((orderAmount * 0.005).toFixed(4));
            const totalReturn = orderAmount + commission;

            let vipConfig = db.prepare('SELECT task_limit FROM vip_levels WHERE level = ?').get(user.vip_level != null ? user.vip_level : 1);
            if (!vipConfig) vipConfig = { task_limit: 40 };
            const dailyOrders = vipConfig.task_limit != null ? vipConfig.task_limit : 40;
            const newProgress = (user.task_progress || 0) + 1;
            const reachedDailyLimit = newProgress >= dailyOrders;

            db.transaction(() => {
                db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', order_id);
                db.prepare('UPDATE users SET balance = balance - ? + ?, task_progress = task_progress + 1 WHERE id = ?')
                    .run(orderAmount, totalReturn, userId);
                if (reachedDailyLimit) {
                    db.prepare('UPDATE users SET allow_grab = 0 WHERE id = ?').run(userId);
                }
                if (order.dispatch_order_id) {
                    db.prepare("UPDATE dispatched_orders SET status = ?, triggered_at = datetime('now') WHERE id = ?")
                        .run('used', order.dispatch_order_id);
                }
                db.prepare(`
                    INSERT INTO ledger (user_id, type, amount, order_no, reason, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                `).run(userId, 'task_reward', commission, order.order_no, 'Task commission', userId);
                try {
                    db.prepare(`
                        INSERT INTO transactions (user_id, type, amount, description, created_at)
                        VALUES (?, ?, ?, ?, datetime('now'))
                    `).run(userId, 'task_commission', commission, `Task commission: ${order.order_no}`);
                } catch (e) {}
                distributeTeamCommission(db, userId, commission, order.order_no);
            })();

            return success(res, {
                order_no: order.order_no,
                amount: orderAmount,
                commission,
                total_return: totalReturn,
                daily_completed: reachedDailyLimit,
                allow_grab: reachedDailyLimit ? 0 : 1,
                message: reachedDailyLimit ? 'Order completed. Daily limit reached; grabbing paused until admin re-enables.' : 'Order completed. Principal and commission returned.'
            }, 'Order completed');
        }

        // start 流程：已扣至冻结的订单，解冻并发放（含三级返佣，同一事务）
        const user = db.prepare('SELECT vip_level FROM users WHERE id = ?').get(userId);
        let vipConfig = db.prepare('SELECT * FROM vip_levels WHERE level = ?').get(user.vip_level != null ? user.vip_level : 1);
        if (!vipConfig) vipConfig = { commission_rate: 0.005 };
        const commission = parseFloat((orderAmount * vipConfig.commission_rate).toFixed(4));
        const totalReturn = orderAmount + commission;

        db.transaction(() => {
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', order_id);
          db.prepare(`
              UPDATE users 
              SET frozen_balance = frozen_balance - ?, 
                  balance = balance + ?
              WHERE id = ?
          `).run(orderAmount, totalReturn, userId);

          try {
            db.prepare(`
                UPDATE user_tasks 
                SET status = ?, completed_at = CURRENT_TIMESTAMP 
                WHERE user_id = ? AND task_id = 1 
                ORDER BY created_at DESC 
                LIMIT 1
            `).run('completed', userId);
          } catch (e) {}

          db.prepare(`
              INSERT INTO ledger (user_id, type, amount, order_no, reason, created_by)
              VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, 'order_reward', totalReturn, order.order_no, 'Order completed', userId);

          try {
            db.prepare(`
                INSERT INTO transactions (user_id, type, amount, description, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `).run(userId, 'task_commission', commission, `Task commission: ${order.order_no}`);
          } catch (e) {}
          distributeTeamCommission(db, userId, commission, order.order_no);
        })();

        return success(res, {
            order_no: order.order_no,
            amount: orderAmount,
            commission: commission,
            total_return: totalReturn,
            message: 'Order completed. Commission credited.'
        }, 'Order completed');
        
    } catch (err) {
        console.error('提交订单失败:', err);
        return error(res, 'Submit failed. Please try again.');
    }
});

/**
 * 获取我的订单列表
 * GET /api/task/my-orders
 */
router.get('/my-orders', authenticate, (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const orders = db.prepare(`
    SELECT id, order_no, amount, commission, status, type, product_name, unit_price, quantity, product_title, product_image, created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId);
  return success(res, orders);
});

module.exports = router;
