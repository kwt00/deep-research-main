import cors from 'cors';
import express, { Request, Response } from 'express';
import path from 'path';
import { Server as WebSocketServer } from 'ws';
import http from 'http';

import { deepResearch, ResearchProgress } from './deep-research';

const app = express();
const PORT = process.env.PORT || 3051;

// Apply middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store all connected WebSocket clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'system',
    message: 'Connected to Deep Research server'
  }));

  // Handle disconnection
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
});

// Broadcast progress updates to all connected clients
function broadcastProgress(progress: ResearchProgress) {
  const message = JSON.stringify({
    type: 'progress',
    progress
  });
  
  clients.forEach(client => {
    try {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    } catch (error) {
      console.error('Error sending message to client:', error);
    }
  });
}

// Broadcast an activity message to all clients
function broadcastActivity(message: string, color: string = 'blue') {
  const activityMessage = JSON.stringify({
    type: 'activity',
    message,
    color
  });
  
  clients.forEach(client => {
    try {
      if (client.readyState === 1) { // OPEN
        client.send(activityMessage);
      }
    } catch (error) {
      console.error('Error sending activity to client:', error);
    }
  });
}

// Broadcast a source to all clients
function broadcastSource(url: string, title: string) {
  const sourceMessage = JSON.stringify({
    type: 'source',
    url,
    title
  });
  
  clients.forEach(client => {
    try {
      if (client.readyState === 1) { // OPEN
        client.send(sourceMessage);
      }
    } catch (error) {
      console.error('Error sending source to client:', error);
    }
  });
}

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'Deep Research API' });
});

// Research API endpoint
app.post('/api/research', async (req: Request, res: Response) => {
  console.log('\nStarting research...\n');
  try {
    const { query, depth = 3, breadth = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    // Broadcast that research is starting
    broadcastActivity(`Starting research: "${query}"`, 'green');

    // Perform deep research with progress updates
    const result = await deepResearch({
      query,
      depth,
      breadth,
      onProgress: (progress) => {
        // Broadcast progress to all WebSocket clients
        broadcastProgress(progress);
        
        // For important stages, also broadcast as activities
        if (progress.message) {
          broadcastActivity(progress.message);
        }
        
        // If a URL is being visited, broadcast it as a source
        if (progress.url) {
          broadcastSource(progress.url, progress.title || progress.url);
        }
        
        console.log(`Progress: ${progress.stage} - ${progress.message || ''} (${progress.percentage}%)`);
      },
    });

    // Broadcast completion
    broadcastActivity('Research completed successfully', 'green');
    
    // Send the result as JSON response
    res.json(result);
  } catch (error) {
    console.error('Error in research:', error);
    
    // Broadcast error
    broadcastActivity(
      `Research error: ${error instanceof Error ? error.message : String(error)}`, 
      'red'
    );
    
    // Return error response
    res.status(500).json({ 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Serve the main HTML page
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
server.listen(PORT, () => {
  console.log(`Deep Research API running on port ${PORT}`);
  console.log(`UI available at http://localhost:${PORT}`);
});

export default app;
