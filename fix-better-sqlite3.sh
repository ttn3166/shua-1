#!/bin/bash
set -e
cd /www/wwwroot/185.39.31.27
cp -p data/taskmall.db data/taskmall.db.bak 2>/dev/null || true
npm rebuild better-sqlite3
node server/scripts/verify-db.js
pm2 restart taskmall 2>/dev/null || pm2 restart all 2>/dev/null || true
echo Done.
