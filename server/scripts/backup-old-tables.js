const { getDb } = require('../db');

const db = getDb();

console.log('💾 Backing up old tables...');

try {
    // 备份 task_templates
    db.exec(`
        CREATE TABLE IF NOT EXISTS task_templates_backup 
        AS SELECT * FROM task_templates;
    `);
    console.log('✅ task_templates backed up');
    
    // 备份 user_tasks
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_tasks_backup 
        AS SELECT * FROM user_tasks;
    `);
    console.log('✅ user_tasks backed up');
    
    console.log('📊 Backup summary:');
    const ttCount = db.prepare('SELECT COUNT(*) as c FROM task_templates').get().c;
    const utCount = db.prepare('SELECT COUNT(*) as c FROM user_tasks').get().c;
    console.log(`  - task_templates: ${ttCount} rows`);
    console.log(`  - user_tasks: ${utCount} rows`);
    
    console.log('\n⚠️  Tables backed up but NOT deleted.');
    console.log('   If you want to delete them, run:');
    console.log('   DROP TABLE task_templates;');
    console.log('   DROP TABLE user_tasks;');
    
} catch (error) {
    console.error('❌ Error backing up tables:', error);
}
