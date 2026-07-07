#!/usr/bin/env node

const args = process.argv.slice(2);
const watch = args.includes('--watch');

console.log(JSON.stringify({ status: 'ok', watch }));
