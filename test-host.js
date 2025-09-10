#!/usr/bin/env node

// Simple test script for the native host
const { spawn } = require('child_process');
const path = require('path');
const processManager = require('./lib/process-manager');

// Create a process to run the host
const hostProcess = spawn('node', ['./index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
processManager.register(hostProcess);

// Send a test connection validation message
function sendTestMessage() {
  const message = { 
    command: 'validateConnection',
    id: 'test_msg_1'
  };
  const messageBuffer = Buffer.from(JSON.stringify(message));
  
  // Create header with message length
  const header = Buffer.alloc(4);
  header.writeUInt32LE(messageBuffer.length, 0);
  
  // Send header + message
  hostProcess.stdin.write(Buffer.concat([header, messageBuffer]));
  
  console.log('Sent test message:', message);
}

// Handle host output
let buffer = Buffer.alloc(0);
hostProcess.stdout.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  
  // Process complete messages
  while (buffer.length >= 4) {
    const messageLength = buffer.readUInt32LE(0);
    
    if (buffer.length < messageLength + 4) break;
    
    const messageData = buffer.slice(4, messageLength + 4).toString();
    buffer = buffer.slice(messageLength + 4);
    
    try {
      const response = JSON.parse(messageData);
      console.log('Received response:', response);
      
      // Exit after receiving response
      setTimeout(() => {
        process.exit(0);
      }, 500);
    } catch (e) {
      console.error('Error parsing response:', e);
    }
  }
});

// Handle host errors
hostProcess.stderr.on('data', (data) => {
  console.error('Host error:', data.toString());
});

// Handle host exit
hostProcess.on('close', (code) => {
  console.log(`Host exited with code ${code}`);
});

// Send test message after a short delay
setTimeout(sendTestMessage, 500);
