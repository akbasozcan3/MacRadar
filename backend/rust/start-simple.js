#!/usr/bin/env node

// Simple Node.js Sensor Hub (Final Working Version)
const { spawn } = require('child_process');
const path = require('path');

function startSimpleSensorHub() {
  console.log('[Rust] Starting simple sensor hub...');
  
  const sensorScript = path.join(__dirname, 'standalone-sensor.js');
  
  const process = spawn('node', [sensorScript], {
    stdio: 'inherit'
  });
  
  process.on('error', (error) => {
    console.error('[Rust] Failed to start sensor hub:', error);
  });
  
  process.on('close', (code) => {
    if (code !== 0) {
      console.error(`[Rust] Sensor hub exited with code ${code}`);
    } else {
      console.log('[Rust] Sensor hub completed successfully');
    }
  });
  
  return process;
}

startSimpleSensorHub();
