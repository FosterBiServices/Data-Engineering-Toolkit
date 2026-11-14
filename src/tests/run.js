// Runs every check, or only those whose file name contains the argument: node run.js adf
const fs = require('fs'), cp = require('child_process'), path = require('path');
const only = process.argv[2] || '';
fs.readdirSync(__dirname).filter(f => /test\.js$/.test(f) && f.indexOf(only) >= 0).forEach(f => {
  console.log('\n===== ' + f); cp.spawnSync('node', [path.join(__dirname, f)], { stdio: 'inherit' });
});
