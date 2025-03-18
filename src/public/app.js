document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const queryInput = document.getElementById('query-input');
  const submitButton = document.getElementById('submit-button');
  const researchQuery = document.getElementById('research-query');
  const researchPrompt = document.getElementById('research-prompt');
  const researchStatus = document.getElementById('research-status');
  const researchResults = document.getElementById('research-results');
  const progressBar = document.getElementById('progress-bar');
  const progressPercentage = document.getElementById('progress-percentage');
  const timeoutCounter = document.getElementById('timeout-counter');
  const activityList = document.getElementById('activity-list');
  const sourcesList = document.getElementById('sources-list');
  const activityTab = document.getElementById('activity-tab');
  const sourcesTab = document.getElementById('sources-tab');
  const activityPanel = document.getElementById('activity-panel');
  const sourcesPanel = document.getElementById('sources-panel');
  const resultsTitle = document.getElementById('results-title');
  const resultsContent = document.getElementById('results-content');
  const statusMessage = document.getElementById('status-message');

  // State variables
  let currentQuery = '';
  let isResearching = false;
  let timeoutInterval = null;
  let timeRemaining = 300; // 5 minutes in seconds
  let activities = [];
  let sources = [];
  let researchTimeout = null;

  // API endpoint - make sure this matches your server endpoint
  const API_ENDPOINT = '/api/research';

  // WebSocket connection
  let socket;
  let socketConnected = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectInterval = 3000; // 3 seconds

  // Connect to WebSocket server
  async function connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Close any existing connection
        if (socket) {
          socket.close();
        }

        // Create new connection
        socket = new WebSocket(`ws://${window.location.hostname}:3051/ws`);

        socket.onopen = function() {
          console.log('WebSocket connected');
          resolve();
        };

        socket.onerror = function(error) {
          console.error('WebSocket error:', error);
          updateStatus('error', 'Failed to connect to the server');
          reject(new Error('WebSocket connection failed'));
        };

        socket.onclose = function() {
          console.log('WebSocket connection closed');
          if (isResearching) {
            updateStatus('error', 'Connection to the server was lost');
            isResearching = false;
            clearTimeout(timeoutId);
          }
        };

        socket.onmessage = function(event) {
          try {
            const data = JSON.parse(event.data);
            console.log('Received data:', data);

            if (data.type === 'error') {
              updateStatus('error', data.message || 'An error occurred');
              isResearching = false;
              clearTimeout(timeoutId);
              return;
            }

            if (data.type === 'done' && data.result) {
              displayResults(data.result);
              isResearching = false;
              clearTimeout(timeoutId);
              return;
            }

            if (data.type === 'progress' && data.progress) {
              updateProgress(data.progress);
              resetTimeout();
            }
          } catch (error) {
            console.error('Error handling message:', error);
            updateStatus('error', 'Error processing server response');
            isResearching = false;
            clearTimeout(timeoutId);
          }
        };
      } catch (error) {
        console.error('Error setting up WebSocket:', error);
        updateStatus('error', 'Failed to set up connection to server');
        reject(error);
      }
    });
  }

  // Process progress updates from WebSocket or API
  function updateProgress(data) {
    if (!data) return;
    
    // Handle different types of progress data
    if (data.type === 'progress' && data.progress) {
      const progress = data.progress;
      
      // Update status message if available
      if (progress.message) {
        statusMessage.textContent = progress.message;
        addActivity(progress.message, 'blue');
      }

      // Update progress bar if percentage is available
      if (progress.percentage !== undefined) {
        const percent = Math.min(100, Math.max(0, progress.percentage));
        progressBar.style.width = `${percent}%`;
        progressPercentage.textContent = `${percent}%`;
      }

      // Add URL to sources if provided
      if (progress.url) {
        addSource(progress.url, progress.title || 'Source from research');
        addActivity(`Visiting: ${progress.url}`, 'blue');
      }
      
      // Update stage information
      if (progress.stage) {
        const stageMap = {
          'generating_queries': 'Generating search queries',
          'queries_generated': 'Search queries generated',
          'searching': 'Searching the web',
          'visiting': 'Visiting source',
          'analyzing': 'Analyzing content',
          'summarizing': 'Creating summary',
          'finishing': 'Finishing research'
        };
        
        const stageMessage = stageMap[progress.stage] || progress.stage;
        addActivity(`Research stage: ${stageMessage}`, 'green');
      }
    }
  }

  // Add a URL to the sources list in real-time
  function addSource(url, title) {
    if (!sources.includes(url)) {
      sources.push({ url, title });
      updateSourcesList();
    }
  }

  // Check if server is running
  async function checkServerStatus() {
    try {
      const response = await fetch('/', {
        method: 'GET',
        headers: {
          'Accept': 'text/html',
        },
      });
      return response.ok;
    } catch (error) {
      console.error('Server status check failed:', error);
      return false;
    }
  }

  // Initialize the UI
  async function init() {
    // First check if server is running
    const serverRunning = await checkServerStatus();
    if (!serverRunning) {
      alert('Error: Cannot connect to the Deep Research server. Make sure it\'s running with "npm run api".');
    }

    // Setup event listeners
    submitButton.addEventListener('click', startResearch);
    queryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') startResearch();
    });

    activityTab.addEventListener('click', () => {
      activityTab.classList.add('active');
      sourcesTab.classList.remove('active');
      activityPanel.classList.remove('hidden');
      sourcesPanel.classList.add('hidden');
    });

    sourcesTab.addEventListener('click', () => {
      sourcesTab.classList.add('active');
      activityTab.classList.remove('active');
      sourcesPanel.classList.remove('hidden');
      activityPanel.classList.add('hidden');
    });

    // Setup example questions as clickable
    const exampleList = document.querySelectorAll('.example-list li');
    exampleList.forEach(example => {
      example.addEventListener('click', () => {
        queryInput.value = example.textContent;
        queryInput.focus();
      });
    });

    // Initial UI setup - make sure prompt container is hidden until needed
    researchPrompt.classList.add('hidden');

    // Add initial activity
    addActivity('Ready to research. Enter a query below.', 'green');

    // Connect to WebSocket server
    connectWebSocket();
  }

  // Start the research process
  async function startResearch() {
    const query = queryInput.value.trim();
    if (!query || isResearching) return;

    currentQuery = query;
    
    // Clear the input field after submission
    queryInput.value = '';
    
    // Reset UI state
    isResearching = true;
    activities = [];
    sources = [];
    researchResults.classList.add('hidden');
    researchStatus.classList.remove('hidden');
    researchPrompt.classList.add('hidden');
    activityList.innerHTML = '';
    sourcesPanel.innerHTML = '';
    statusMessage.textContent = 'Starting research...';
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0%';
    lastUpdateTime.textContent = new Date().toLocaleTimeString();
    sourcesCount = 0;

    // Add to activity
    addActivity(`Starting research for: "${query}"`, 'green');

    try {
      // Start websocket connection if needed
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        await connectWebSocket();
      }

      // Send the research request
      socket.send(JSON.stringify({
        type: 'research',
        query
      }));

      // Start timeout monitor
      startTimeout();
    } catch (error) {
      console.error('Error starting research:', error);
      addActivity(`Error: ${error.message}`, 'red');
      updateStatus('error', error.message);
      isResearching = false;
      clearTimeout(timeoutId);
    }
  }

  // Format results as HTML from markdown
  function formatResults(text) {
    if (!text) return '<p>No results available</p>';

    // Log the raw text to debug
    console.log('Raw text to format:', text);

    // Convert basic markdown to HTML
    let html = text
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Headers
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^#### (.*?)$/gm, '<h4>$1</h4>')
      // Lists
      .replace(/^- (.*?)$/gm, '<li>$1</li>')
      .replace(/<\/li>\n<li>/g, '</li><li>')
      .replace(/<li>(.*?)<\/li>/gs, '<ul>$&</ul>')
      .replace(/<\/ul>\n<ul>/g, '');

    // Ensure we're wrapping in paragraph tags but not double-wrapping
    html = html.startsWith('<p>') ? html : `<p>${html}</p>`;

    return html;
  }

  // Display results
  function displayResults(text) {
    researchStatus.classList.add('hidden');
    researchResults.classList.remove('hidden');
    researchPrompt.classList.add('hidden'); // Make sure prompt is hidden
    resultsTitle.textContent = `Results for: "${currentQuery}"`;
    
    // Scroll to the top of the results container
    researchResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Format and display the content
    resultsContent.innerHTML = formatResults(text);
    
    // Add a final activity
    addActivity('Research results are ready', 'green');
  }

  // Update timeout counter
  function updateTimeoutCounter() {
    if (timeRemaining <= 0) {
      clearInterval(timeoutInterval);
      return;
    }

    timeRemaining--;
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timeoutCounter.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Add activity to the log
  function addActivity(text, dotColor = 'green') {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const activity = { text, timestamp, dotColor };

    activities.unshift(activity);

    // Update UI
    updateActivityList();
  }

  // Update activity list in the UI
  function updateActivityList() {
    activityList.innerHTML = '';
    activities.forEach(activity => {
      const li = document.createElement('li');
      li.className = 'activity-item';
      li.innerHTML = `
        <div>
          <span class="activity-item-dot ${activity.dotColor}"></span>
          ${activity.text}
        </div>
        <div class="timestamp">${activity.timestamp}</div>
      `;
      activityList.appendChild(li);
    });
  }

  // Update sources list in the UI
  function updateSourcesList() {
    sourcesList.innerHTML = '';
    if (sources.length === 0) {
      const li = document.createElement('li');
      li.className = 'source-item';
      li.textContent = 'No sources yet';
      sourcesList.appendChild(li);
      return;
    }

    sources.forEach(source => {
      const li = document.createElement('li');
      li.className = 'source-item';

      // Create a clickable link for the source
      const a = document.createElement('a');
      a.href = source.url;
      a.target = '_blank';
      a.textContent = source.title || source.url;
      a.style.textDecoration = 'none';
      a.style.color = 'var(--primary-color)';

      li.appendChild(a);
      sourcesList.appendChild(li);
    });
  }

  // Show error status
  function updateStatus(type, message) {
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0%';
    
    // Update UI with error info
    statusMessage.textContent = message || 'An error occurred';
    
    // If it's an error, don't mark results as ready
    if (type === 'error') {
      addActivity(`Error: ${message}`, 'red');
      researchStatus.classList.remove('hidden');
    }
  }

  // Initialize the app
  init();
});
