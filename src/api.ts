import cors from 'cors';
import express, { Request, Response } from 'express';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables from .env.local first, then fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

// Log environment variables to verify they're loaded correctly
console.log('API Server starting with:');
console.log('- Environment:', process.env.NODE_ENV || 'development');
console.log('- CONTEXT_SIZE:', process.env.CONTEXT_SIZE || 'Not set');
console.log('- CUSTOM_MODEL:', process.env.CUSTOM_MODEL || 'Not set');

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
const clients = new Set<WebSocket>();

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'system',
    message: 'Connected to Deep Research server'
  }));

  // Handle message from client
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received message:', data);
      
      if (data.type === 'research' && data.query) {
        // Start research process
        processResearch(data.query, ws);
      }
    } catch (error: any) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error processing your request'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
});

// Process research request
async function processResearch(query: string, socket: WebSocket) {
  try {
    broadcastActivity(`Starting research for: "${query}"`, 'blue');
    
    // Run the research process
    const result = await deepResearch({
      query,
      depth: 2,
      breadth: 3,
      onProgress: (progress) => {
        // Update progress
        broadcastProgress(progress);
        
        // Track sources
        if (progress.url && progress.title) {
          broadcastSource(progress.url, progress.title);
        }
        
        // Log activity based on stage
        if (progress.stage === 'generating_queries') {
          broadcastActivity('Generating search queries...', 'blue');
        } else if (progress.stage === 'searching') {
          broadcastActivity(`Searching: ${progress.currentQuery || 'unknown'}`, 'blue');
        } else if (progress.stage === 'processing_results') {
          broadcastActivity(`Processing search results: ${progress.percentage}%`, 'blue');
        } else if (progress.stage === 'generating_answer') {
          broadcastActivity('Generating final answer...', 'blue');
        }
      }
    });

    // Broadcast completion
    broadcastActivity('Research completed successfully', 'green');
    
    // Send final result to client
    socket.send(JSON.stringify({
      type: 'done',
      result: {
        query,
        answer: result.answer || 'No conclusive answer found.',
        learnings: result.learnings || [],
        sources: result.visitedUrls || []
      }
    }));
  } catch (error: any) {
    console.error('Research error:', error);
    broadcastActivity(`Error: ${error.message}`, 'red');
    
    // Send error to client
    socket.send(JSON.stringify({
      type: 'error',
      message: `Research failed: ${error.message}`
    }));
  }
}

// Broadcast progress updates to all connected clients
function broadcastProgress(progress: ResearchProgress) {
  // Make sure the progress has a percentage value
  if (progress.percentage === undefined) {
    // Calculate percentage based on stage if possible
    if (progress.stage) {
      const stagePercentages: Record<string, number> = {
        'starting': 5,
        'generating_queries': 10,
        'queries_generated': 15,
        'searching': 20,
        'visited_source': 40,
        'analyzing': 60,
        'processing_results': 70,
        'summarizing': 80,
        'generating_answer': 90,
        'finishing': 95,
        'completed': 100
      };
      
      // Use stage percentage if available, otherwise don't modify
      if (stagePercentages[progress.stage]) {
        progress.percentage = stagePercentages[progress.stage];
      }
    }
  }

  // Log the progress update for debugging
  console.log(`Broadcasting progress: ${progress.stage || 'unknown'} - ${progress.percentage || 'unknown'}%`);

  // Send progress update to all connected clients
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'progress',
        progress
      }));
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
      if (client.readyState === WebSocket.OPEN) {
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
      if (client.readyState === WebSocket.OPEN) {
        client.send(sourceMessage);
      }
    } catch (error) {
      console.error('Error sending source to client:', error);
    }
  });
}

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    contextSize: process.env.CONTEXT_SIZE || 'Not set',
    websocket: wss ? 'active' : 'inactive',
    clientsConnected: clients.size
  });
});

// Apply changes from .env.local - ensure proper loading order
const updateEnvVars = () => {
  console.log('Reloading environment variables...');
  try {
    // Force reload .env.local
    dotenv.config({ path: '.env.local', override: true });
    console.log('Updated CONTEXT_SIZE:', process.env.CONTEXT_SIZE);
  } catch (error) {
    console.error('Error reloading environment variables:', error);
  }
};

// Check if environment variables changed
setInterval(updateEnvVars, 60000); // Check every minute

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
