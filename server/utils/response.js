/**
 * 统一响应格式工具
 */

function success(res, data = null, message = 'Success') {
  return res.json({
    success: true,
    message,
    data
  });
}

function error(res, message = 'Error', statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    error: message
  });
}

module.exports = { success, error };
