#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Path to dashboard state file
const stateFile = path.join(__dirname, 'data/state.latest.json');

try {
  // Read current state
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  
  // Clear device identity from localStorage simulation
  // (Note: actual localStorage is in browser, not in this file)
  console.log('To clear device identity, you need to:');
  console.log('1. Open browser developer tools');
  console.log('2. Go to Application tab > Local Storage');
  console.log('3. Find and delete "openclaw-device-identity" key');
  console.log('4. Refresh the dashboard page');
  
  // Alternatively, we can force a refresh by incrementing version
  state.version = (state.version || 0) + 1;
  
  // Write back
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log('State version incremented to force refresh');
  
} catch (e) {
  console.error('Error:', e.message);
}
