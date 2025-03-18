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
  const timeoutCounterElement = document.getElementById('timeout-counter');
  const activityList = document.getElementById('activity-list');
  const sourcesList = document.getElementById('sources-list');
  const activityTab = document.getElementById('activity-tab');
  const sourcesTab = document.getElementById('sources-tab');
  const activityPanel = document.getElementById('activity-panel');
  const sourcesPanel = document.getElementById('sources-panel');
  const resultsTitle = document.getElementById('results-title');
  const resultsContent = document.getElementById('results-content');
  const statusMessage = document.getElementById('status-message');
  const lastUpdateTime = document.getElementById('last-update-time');
  const clearButton = document.getElementById('clear-button');
  const errorElement = document.getElementById('error-message');

  // State variables
  let currentQuery = '';
  let socket = null;
  let isResearching = false;
  let activities = [];
  let sources = [];
  let sourcesCount = 0;
  let timeoutId = null;
  let timeoutInterval = null;
  let timeoutCounter = 0;
  let researchTimeout = null;
  let elapsedSeconds = 0;

  // API endpoint - make sure this matches your server endpoint
  const API_ENDPOINT = '/api/research';

  // WebSocket connection
  let socketConnected = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectInterval = 3000; // 3 seconds

  // Connect to WebSocket server
  async function connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Create a proper URL based on the current protocol and hostname
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}:3051/ws`;
        
        console.log('Connecting to WebSocket server:', wsUrl);
        
        // Close any existing connection
        if (socket && socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
        
        // Create new connection
        socket = new WebSocket(wsUrl);
        
        socket.onopen = function() {
          console.log('WebSocket connected');
          addActivity('Connected to research server', 'green');
          resolve(socket);
        };
        
        socket.onclose = function() {
          console.log('WebSocket connection closed');
          addActivity('Disconnected from research server', 'red');
          
          // Try to reconnect after a delay
          setTimeout(() => {
            connectWebSocket()
              .catch(error => console.error('Reconnection failed:', error));
          }, 5000);
        };
        
        socket.onerror = function(error) {
          console.error('WebSocket error:', error);
          addActivity('Error connecting to research server', 'red');
          reject(new Error('WebSocket connection error'));
        };
        
        socket.onmessage = handleSocketMessage;
      } catch (error) {
        console.error('Error setting up WebSocket:', error);
        addActivity('Failed to connect to research server', 'red');
        reject(error);
      }
    });
  }

  // Process WebSocket message
  function handleSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('Received WebSocket message:', data);

      // Reset timeout on any message
      resetTimeout();

      // Handle different message types
      switch (data.type) {
        case 'system':
          // System messages like connection established
          addActivity(data.message, 'blue');
          break;

        case 'progress':
          // Process progress updates
          handleProgressUpdate(data);
          break;

        case 'result':
          // Handle research results
          if (data.result) {
            displayResults(data.result);
            // Only set to 100% when we have actual results
            updateProgressBar(100);
            updateStatusMessage('Research complete');
            addActivity('Research complete. Results have been displayed.', 'green');
            
            // Switch to results tab
            switchToResultsTab();
            
            // Research is done
            isResearching = false;
            document.getElementById('submit-button').disabled = false;
          } else {
            console.error('Received empty result data');
            addActivity('Error: Received empty result data', 'red');
          }
          break;

        case 'error':
          // Handle error messages
          console.error('Received error from server:', data.message);
          errorElement.textContent = data.message;
          errorElement.style.display = 'block';
          addActivity(data.message, 'red');
          
          // Check for unauthorized error
          if (data.message.includes('Unauthorized') || data.message.includes('API Key')) {
            addActivity('Authorization failed. Please check your API keys.', 'red');
          }
          
          // Still update progress to show we're done (with error)
          updateProgressBar(100);
          updateStatusMessage('Error occurred');
          isResearching = false;
          document.getElementById('submit-button').disabled = false;
          clearTimeout(timeoutId);
          break;

        case 'activity':
          // Activity messages (status updates, etc.)
          addActivity(data.message, data.color || 'blue');
          break;

        case 'source':
          // Handle source updates directly
          if (data.url) {
            addSource(data.url, data.title || 'Research Source');
            addActivity(`Found source: ${data.url}`, 'green');
            switchToSourcesTab();
          }
          break;
          
        case 'done':
          // Handle research completion
          updateProgressBar(100);
          updateStatusMessage('Research complete');
          addActivity('Research process completed.', 'green');
          isResearching = false;
          document.getElementById('submit-button').disabled = false;
          
          // If we have results, display them
          if (data.result) {
            displayResults(data.result);
            switchToResultsTab();
          } else {
            addActivity('Research completed, but no results were returned.', 'yellow');
          }
          break;

        default:
          // Log unhandled message types for debugging
          console.log('Unhandled message type:', data.type);
          if (data.message) {
            addActivity(`Unhandled message: ${data.message}`, 'gray');
          }
      }

    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      addActivity('Error processing server message', 'red');
    }
  }

  // Handle progress updates
  function handleProgressUpdate(data) {
    // For backward compatibility, check if progress is wrapped
    const progress = data.progress || data;
    
    // Limit progress to 95% until we get actual results
    // Only the final 'result' or 'done' message should set it to 100%
    let cappedPercentage = progress.percentage;
    if (cappedPercentage !== undefined && cappedPercentage > 95) {
      console.log(`Capping progress from ${cappedPercentage}% to 95% until final results`);
      cappedPercentage = 95;
    }
    
    // Update progress bar with potentially capped value
    if (cappedPercentage !== undefined) {
      updateProgressBar(cappedPercentage);
    }
    
    // Handle stage updates - only log important stages
    if (progress.stage) {
      // Map server stage names to more user-friendly descriptions
      const stageMap = {
        'generating_queries': 'Generating search queries',
        'queries_generated': 'Search queries generated',
        'searching': 'Searching the web',
        'visiting': 'Visiting source',
        'analyzing': 'Analyzing content',
        'processing_results': 'Processing results',
        'summarizing': 'Creating summary',
        'finishing': 'Finishing research',
        'generating_answer': 'Writing final report'
      };
      
      // Get friendly stage name or use the original if not in map
      const stageMessage = stageMap[progress.stage] || progress.stage;
      
      // Update status message with stage
      updateStatusMessage(stageMessage);
      
      // Only log important stages that are useful to see
      const importantStages = ['searching', 'visiting', 'analyzing', 'summarizing', 'finishing', 'generating_answer'];
      if (importantStages.includes(progress.stage)) {
        // Add activity only if it's a new stage
        if (!activities.some(a => a.message === `Stage: ${stageMessage}`)) {
          addActivity(`Stage: ${stageMessage}`, 'green');
        }
      }
      
      // If we're writing the final report, show special status
      if (progress.stage === 'generating_answer') {
        updateStatusMessage('Writing final report...');
        addActivity('Writing final research report', 'green');
        updateProgressBar(95); // Ensure we're at 95% when writing final report
      }
    }
    
    // Handle message updates - only if truly informative
    if (progress.message && 
        !progress.message.includes("Starting") && 
        !progress.message.includes("beginning") &&
        !progress.message.includes("initializing")) {
      updateStatusMessage(progress.message);
      
      // Only log certain types of messages
      if (progress.message.includes("search") || 
          progress.message.includes("extracted") ||
          progress.message.includes("found") ||
          progress.message.includes("error") ||
          progress.message.includes("complete")) {
        addActivity(progress.message, 'blue');
      }
    }
    
    // Handle URL updates (sources) - Always important
    if (progress.url) {
      addSource(progress.url, progress.title || 'Research Source');
      
      // Only log important source events, not just visits
      if (progress.stage === 'found_source' || progress.message?.includes('Found source')) {
        addActivity(`Found source: ${progress.url}`, 'green');
        switchToSourcesTab();
      }
    }
  }

  // Update the progress bar
  function updateProgressBar(percentage) {
    if (percentage !== undefined && !isNaN(percentage)) {
      // Get current width
      const currentWidth = parseInt(progressBar.style.width || '0');
      
      // Only update if the new percentage is higher than the current one
      // This prevents the progress bar from going backward
      if (percentage > currentWidth) {
        progressBar.style.width = `${percentage}%`;
        
        // Also update the percentage text if present
        const percentageElement = document.getElementById('progress-percentage');
        if (percentageElement) {
          percentageElement.textContent = `${Math.round(percentage)}%`;
        }
        
        // Update the last update time if the function exists
        if (typeof updateLastUpdateTime === 'function') {
          updateLastUpdateTime();
        } else {
          // Fallback implementation if the function doesn't exist
          const now = new Date();
          const timeString = now.toLocaleTimeString();
          if (lastUpdateTime) {
            lastUpdateTime.textContent = timeString;
          }
        }
      } else {
        console.log(`Ignoring lower progress value: ${percentage}% (current: ${currentWidth}%)`);
      }
    }
  }

  // Update the status message
  function updateStatusMessage(message) {
    if (message && typeof message === 'string') {
      statusMessage.textContent = message;
    }
  }

  // Add a URL to the sources list in real-time
  function addSource(url, title) {
    // Check if this source is already in our list
    if (!sources.some(source => source.url === url)) {
      sources.push({ url, title });
      sourcesCount++;
      updateSourcesList();
      
      // Automatically switch to the sources tab when we add a new source
      if (sourcesCount === 1) {
        sourcesTab.click();
      }
    }
  }

  // Update the sources list in the UI
  function updateSourcesList() {
    // Clear existing list
    sourcesList.innerHTML = '';
    
    if (sources.length === 0) {
      sourcesList.innerHTML = '<div class="empty-list">No sources yet</div>';
      return;
    }
    
    // Create the sources list
    sources.forEach((source, index) => {
      const sourceItem = document.createElement('div');
      sourceItem.className = 'source-item';
      
      const sourceLink = document.createElement('a');
      sourceLink.href = source.url;
      sourceLink.target = '_blank';
      sourceLink.textContent = source.title || source.url;
      
      sourceItem.appendChild(sourceLink);
      sourcesList.appendChild(sourceItem);
    });
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
    console.log('Initializing UI and setting up event listeners');
    
    // Setup search button event listener
    console.log('Setting up submit button:', submitButton);
    submitButton.addEventListener('click', function(e) {
      console.log('Submit button clicked');
      e.preventDefault();
      startResearch();
    });
    
    // Setup Enter key press event listener
    console.log('Setting up Enter key handler for query input:', queryInput);
    queryInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        console.log('Enter key pressed in query input');
        e.preventDefault();
        startResearch();
      }
    });
    
    // Only attach event listener if the clear button exists
    if (clearButton) {
      clearButton.addEventListener('click', resetUI);
    }
    
    // Tab switching
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
    
    // Initial tab selection
    activityTab.click();
    
    // Initial UI setup - make sure prompt container is hidden until needed
    researchPrompt.classList.add('hidden');
    
    // Add initial activity
    addActivity('Ready to research. Enter a query below.', 'green');
    
    // Set up the WebSocket connection
    try {
      await connectWebSocket();
      updateStatusMessage('Ready to start research');
    } catch (error) {
      console.error('Failed to connect:', error);
      updateStatusMessage('Failed to connect to the server. Please reload the page or check if the server is running.');
    }
  }

  // Start the research process
  async function startResearch() {
    console.log('startResearch function called');
    const query = queryInput.value.trim();
    console.log('Query received:', query);
    
    // Store the query before clearing the input field
    const queryText = query;
    
    // Clear the input field
    queryInput.value = '';
    
    // Clear test mode flag if it was set
    localStorage.removeItem('test_mode_active');
    
    if (!queryText) {
      console.log('Empty query, showing error');
      errorElement.textContent = 'Please enter a research query';
      errorElement.style.display = 'block';
      return;
    }
    
    // Check for test mode trigger
    if (queryText.toLowerCase().includes('[test]')) {
      console.log('Test mode detected, starting test mode');
      runTestMode(queryText.replace('[test]', '').trim());
      return;
    }
    
    // Normal research flow
    try {
      console.log('Starting normal research flow');
      
      // Reset UI
      errorElement.style.display = 'none';
      progressBar.style.width = '0%';
      progressPercentage.textContent = '0%';
      researchStatus.classList.remove('hidden');
      
      // Clear previous results
      resultsContent.innerHTML = '';
      sources = [];
      sourcesCount = 0;
      activities = [];
      
      // Clear previous results if visible
      researchResults.classList.add('hidden');
      
      // Store the query 
      currentQuery = queryText;
      
      // Update activity
      addActivity(`Starting research for: "${queryText}"`, 'blue');
      
      // Set researching state
      isResearching = true;
      document.getElementById('submit-button').disabled = true;
      
      // Ensure timeout view is reset
      resetTimeout();
      updateSourcesList();
      
      // Show status area
      statusMessage.textContent = 'Starting research...';
      
      // Make sure WebSocket is connected before proceeding
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not connected, connecting now...');
        try {
          await connectWebSocket();
          console.log('WebSocket connected successfully');
        } catch (wsError) {
          console.error('WebSocket connection failed:', wsError);
          throw new Error('Could not connect to the research server. Please try again.');
        }
        
        // Give the socket a moment to connect
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Check if socket is now connected
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not open after connection attempt');
        throw new Error('Could not establish WebSocket connection. Please try again.');
      }
      
      // Send research request directly via WebSocket
      console.log('Sending research request for:', queryText);
      socket.send(JSON.stringify({
        type: 'research',
        query: queryText
      }));
      console.log('Research request sent via WebSocket');
      
    } catch (error) {
      console.error('Error starting research:', error);
      errorElement.textContent = error.message || 'Failed to start research';
      errorElement.style.display = 'block';
      statusMessage.textContent = 'Error starting research';
      isResearching = false;
      document.getElementById('submit-button').disabled = false;
    }
  }
  
  // Run test mode with simulated responses
  function runTestMode(query) {
    console.log('Running test mode for:', query);
    
    // Set flag that we're in test mode
    localStorage.setItem('test_mode_active', 'true');
    
    // Reset UI - safely checking for elements first
    if (errorElement) {
      errorElement.style.display = 'none';
    }
    
    // Progress bar updates - ensure we use the high water mark approach
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0%';
    researchStatus.classList.remove('hidden');
    
    // Clear previous data
    resultsContent.innerHTML = '';
    sources = [];
    sourcesCount = 0;
    activities = [];
    
    // Clear previous results if visible
    researchResults.classList.add('hidden');
    
    // Store query
    currentQuery = query || 'Test query for debugging';
    
    // Set researching state
    isResearching = true;
    document.getElementById('submit-button').disabled = true;
    
    // Show status messages
    statusMessage.textContent = 'TEST MODE: Starting research...';
    addActivity(`TEST MODE: Starting mock research for: "${query}"`, 'purple');
    
    // Simulate the research process
    simulateResearchProcess(query);
  }
  
  // Simulate the entire research process with fake data
  function simulateResearchProcess(query) {
    const testStages = [
      { stage: 'generating_queries', percentage: 10, delay: 1000 },
      { stage: 'queries_generated', percentage: 15, delay: 1000 },
      { stage: 'searching', percentage: 25, delay: 1500 },
      { stage: 'visiting', percentage: 40, delay: 2000, url: 'https://example.com/test1', title: 'Test Source 1' },
      { stage: 'analyzing', percentage: 55, delay: 1500 },
      { stage: 'visiting', percentage: 65, delay: 2000, url: 'https://example.com/test2', title: 'Test Source 2' },
      { stage: 'analyzing', percentage: 75, delay: 1500 },
      { stage: 'processing_results', percentage: 85, delay: 1500 },
      { stage: 'summarizing', percentage: 90, delay: 2000 },
      { stage: 'generating_answer', percentage: 95, delay: 3000 },
      { stage: 'done', percentage: 100, delay: 1000 }
    ];
    
    let currentIndex = 0;
    
    // Function to process the next stage
    function processNextStage() {
      if (currentIndex >= testStages.length) {
        // All stages complete, show results
        displayTestResults(query);
        return;
      }
      
      // Get current stage
      const stage = testStages[currentIndex];
      
      // Create progress message
      const progressData = {
        type: 'progress',
        progress: {
          stage: stage.stage,
          percentage: stage.percentage,
          message: `TEST MODE: ${getStageMessage(stage.stage)}`
        }
      };
      
      // If this stage has a URL, add it
      if (stage.url) {
        progressData.progress.url = stage.url;
        progressData.progress.title = stage.title;
      }
      
      // Process the stage
      handleProgressUpdate(progressData);
      
      // If this is the final "done" stage
      if (stage.stage === 'done') {
        // Send the done message
        setTimeout(() => {
          const doneData = { 
            type: 'done',
            result: getTestResults(query)
          };
          handleSocketMessage({ data: JSON.stringify(doneData) });
        }, stage.delay);
      } else {
        // Move to next stage after delay
        currentIndex++;
        setTimeout(processNextStage, stage.delay);
      }
    }
    
    // Helper to get a message for the stage
    function getStageMessage(stage) {
      const messages = {
        'generating_queries': 'Generating search queries',
        'queries_generated': 'Search queries generated',
        'searching': 'Searching the web',
        'visiting': 'Visiting source',
        'analyzing': 'Analyzing content',
        'processing_results': 'Processing results',
        'summarizing': 'Creating summary',
        'finishing': 'Finishing research',
        'generating_answer': 'Writing final report',
        'done': 'Research complete'
      };
      return messages[stage] || stage;
    }
    
    // Start the process
    processNextStage();
  }
  
  // Display test results with sample markdown
  function displayTestResults(query) {
    const testResults = getTestResults(query);
    
    // Process as if we received a result message
    const resultData = {
      type: 'result',
      result: testResults
    };
    
    // Handle the fake result
    handleSocketMessage({ data: JSON.stringify(resultData) });
  }
  
  // Generate test results with rich markdown
  function getTestResults(query) {
    // Create a sample report with various markdown elements to test formatting
    return {
      query: query,
      answer: `# Test Report: ${query}\n\n` +
        `## Overview\n\n` +
        `This is a **test report** generated in *test mode* to demonstrate markdown formatting and verify that the report generation is working correctly without consuming Firecrawl credits.\n\n` +
        `### Key Points\n\n` +
        `1. This is an ordered list item 1\n` +
        `2. This is an ordered list item 2\n` +
        `3. This is an ordered list item 3\n\n` +
        `### Sample Data\n\n` +
        `- This is an unordered list item\n` +
        `- This is another unordered list item\n` +
        `- This is a third unordered list item\n\n` +
        `## Code Examples\n\n` +
        "```javascript\n" +
        "function testFunction() {\n" +
        "  console.log('This is a test code block');\n" +
        "  return 'Testing formatting';\n" +
        "}\n" +
        "```\n\n" +
        `### Inline Code\n\n` +
        `You can use \`inline code\` for small code snippets.\n\n` +
        `## Blockquotes\n\n` +
        `> This is a blockquote to test the formatting of quoted text.\n` +
        `> It can span multiple lines and will be styled appropriately.\n\n` +
        `## Links and Images\n\n` +
        `[This is a test link](https://example.com)\n\n` +
        `![Test Image](https://via.placeholder.com/150)\n\n` +
        `## Conclusion\n\n` +
        `This test report has verified that the markdown formatting is working correctly. You can now proceed with confidence that the report generation functionality is operational.\n\n` +
        `---\n\n` +
        `*Generated in test mode - no Firecrawl credits were consumed*`,
      sources: [
        { url: 'https://example.com/test1', title: 'Test Source 1' },
        { url: 'https://example.com/test2', title: 'Test Source 2' }
      ]
    };
  }
  
  // Format results as HTML from markdown
  function formatResults(text) {
    console.log('Raw text to format:', text);
    
    if (!text) return '<p>No results available</p>';

    // Ensure text is a string
    let answer = '';
    if (typeof text !== 'string') {
      // Try to extract answer from different object structures
      if (text.answer) {
        answer = text.answer;
      } else if (text.result && text.result.answer) {
        answer = text.result.answer;
      } else if (text.content) {
        answer = text.content;
      } else if (text.result && text.result.content) {
        answer = text.result.content;
      } else if (text.result && typeof text.result === 'string') {
        answer = text.result;
      } else if (text.response && typeof text.response === 'string') {
        answer = text.response;
      } else {
        // If we can't get a string, return a placeholder
        console.error('Cannot format non-string result:', text);
        return '<p>Results received but in an unexpected format. Please check console logs.</p>';
      }
    } else {
      answer = text;
    }

    // Convert markdown to HTML with more comprehensive formatting
    // Process headers first - from largest to smallest to avoid nested replacements
    let html = answer
      // Headers - process in order of size (h1 to h6)
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^#### (.*?)$/gm, '<h4>$1</h4>')
      .replace(/^##### (.*?)$/gm, '<h5>$1</h5>')
      .replace(/^###### (.*?)$/gm, '<h6>$1</h6>')
      
      // Bold - both ** and __ formats
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      
      // Italic - both * and _ formats
      .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      
      // Code blocks with language
      .replace(/```(\w+)?\s*([\s\S]*?)```/g, function(match, language, code) {
        return `<pre class="code-block${language ? ' language-'+language : ''}"><code>${code.trim()}</code></pre>`;
      })
      
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      
      // Blockquotes
      .replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>')
      .replace(/<\/blockquote>\n<blockquote>/g, '<br>')
      
      // Ordered lists
      .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
      .replace(/<\/li>\n<li>/g, '</li><li>')
      .replace(/(<li>.*?<\/li>)/gs, '<ol>$1</ol>')
      .replace(/<\/ol>\n<ol>/g, '')
      
      // Unordered lists - handle both - and * as bullet points
      .replace(/^- (.*?)$/gm, '<li>$1</li>')
      .replace(/^\* (.*?)$/gm, '<li>$1</li>')
      .replace(/<\/li>\n<li>/g, '</li><li>')
      .replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>')
      .replace(/<\/ul>\n<ul>/g, '')
      
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      
      // Images
      .replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="result-image">')
      
      // Horizontal rule
      .replace(/^---$/gm, '<hr>')
      
      // Handle paragraphs - do this last to avoid interfering with other elements
      .replace(/\n\n/g, '</p><p>');

    // Ensure we're wrapping in paragraph tags but not double-wrapping
    if (!html.startsWith('<h1>') && 
        !html.startsWith('<h2>') && 
        !html.startsWith('<h3>') && 
        !html.startsWith('<p>') && 
        !html.startsWith('<ul>') && 
        !html.startsWith('<ol>') && 
        !html.startsWith('<blockquote>')) {
      html = `<p>${html}</p>`;
    }
    
    // Clean up any nested paragraphs in lists
    html = html.replace(/<li><p>(.*?)<\/p><\/li>/g, '<li>$1</li>');
    
    return html;
  }

  // Display research results
  function displayResults(result) {
    console.log('Displaying results:', result);
    
    if (!result) {
      updateStatusMessage('No results received');
      return;
    }
    
    try {
      // Don't hide the status, just update its content
      isResearching = false;
      researchStatus.classList.remove('hidden');
      progressBar.style.width = '100%';
      progressPercentage.textContent = '100%';
      statusMessage.textContent = 'Research complete';
      
      // Make results visible
      researchResults.classList.remove('hidden');
      
      // Format the query
      researchQuery.textContent = result.query || currentQuery;
      
      // Format the results
      const formattedText = formatResults(result);
      resultsContent.innerHTML = formattedText;
      
      // Update title
      resultsTitle.textContent = 'Research Complete';
      
      // Process any sources that came with the result
      if (result.sources && Array.isArray(result.sources)) {
        result.sources.forEach(source => {
          if (source.url && source.title) {
            addSource(source.url, source.title);
          }
        });
      }
      
      // If we have sources, make sure they're visible
      if (sources.length > 0) {
        sourcesTab.click();
      } else {
        activityTab.click();
      }
      
      // Final activity
      addActivity('Research complete!', 'green');
      
      // Scroll to top of results
      researchResults.scrollIntoView({ behavior: 'smooth' });
      
      // Clear any running timers
      if (timeoutInterval) {
        clearInterval(timeoutInterval);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Error displaying results:', error);
      updateStatusMessage('Error displaying results: ' + error.message);
    }
  }

  // Reset the timeout counter
  function resetTimeout() {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Clear the interval if it exists
    if (timeoutInterval) {
      clearInterval(timeoutInterval);
    }
    
    // If we're not actively researching, don't set a new timeout
    if (!isResearching) {
      return;
    }
    
    // Create timeout elements if they don't exist
    if (!document.getElementById('timeout-counter')) {
      const timeoutContainer = document.createElement('div');
      timeoutContainer.id = 'timeout-container';
      timeoutContainer.className = 'timeout-container';
      
      const timeoutCounter = document.createElement('span');
      timeoutCounter.id = 'timeout-counter';
      timeoutCounter.className = 'timeout-counter';
      
      timeoutContainer.appendChild(document.createTextNode('Time remaining: '));
      timeoutContainer.appendChild(timeoutCounter);
      
      // Add it to the status bar
      const statusContainer = document.querySelector('.status-container');
      statusContainer.appendChild(timeoutContainer);
    }
    
    // Start with 5 minutes (300 seconds)
    const timeout = 300; // 5 minutes in seconds
    let remainingSeconds = timeout;
    
    // Update timeout display
    const updateTimeoutDisplay = () => {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      document.getElementById('timeout-counter').textContent = 
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };
    
    // Start new interval to track remaining time
    timeoutInterval = setInterval(() => {
      remainingSeconds--;
      updateTimeoutDisplay();
      
      // If time is up, clear the interval
      if (remainingSeconds <= 0) {
        clearInterval(timeoutInterval);
      }
    }, 1000);
    
    // Start new timeout for research (5 minutes)
    timeoutId = setTimeout(() => {
      addActivity('Research timed out after 5 minutes. Please try again or refine your query.', 'red');
      updateStatusMessage('Research timed out');
      isResearching = false;
      
      // Clear interval when timeout occurs
      clearInterval(timeoutInterval);
      
      // Re-enable search button
      document.getElementById('submit-button').disabled = false;
    }, timeout * 1000); // 5 minute timeout
    
    // Initial display update
    updateTimeoutDisplay();
  }

  // Add activity to the log
  function addActivity(message, color = 'blue') {
    // Skip empty messages
    if (!message || message.trim() === '') {
      return;
    }
    
    // Skip certain redundant messages
    if (activities.some(a => a.message === message)) {
      return; // Don't add duplicate messages
    }
    
    // Filter out non-essential messages
    const lowercaseMsg = message.toLowerCase();
    
    // Skip system startup messages
    if (lowercaseMsg.includes('connected to') || 
        lowercaseMsg.includes('starting ') || 
        lowercaseMsg.includes('initializing')) {
      return;
    }
    
    // Skip purely informational stage messages that don't provide real insight
    if (lowercaseMsg.includes('beginning search') || 
        lowercaseMsg.includes('generating search queries for') ||
        lowercaseMsg.includes('starting research for') ||
        lowercaseMsg.includes('research in progress')) {
      return;
    }
    
    // Skip redundant completion messages
    if (message === 'Research completed successfully' && 
        activities.some(a => a.message.includes('Research complete'))) {
      return;
    }
    
    // Highlight API key errors with more information
    if (lowercaseMsg.includes('api key') || lowercaseMsg.includes('unauthorized')) {
      message = `API Key Error: ${message}`;
      color = 'red';
    }
    
    // Add timestamp and format the message
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add to our activities array
    const activity = {
      message,
      color,
      timestamp
    };
    
    activities.unshift(activity); // Add to beginning (newest first)
    
    // Limit the number of activities to prevent memory issues
    if (activities.length > 100) {
      activities.pop(); // Remove oldest
    }
    
    // Update the UI
    renderActivities();
  }

  // Render activities in the UI
  function renderActivities() {
    // Clear the list
    activityList.innerHTML = '';
    
    // Add each activity
    activities.forEach(activity => {
      const item = document.createElement('li');
      item.className = 'activity-item';
      
      // Add color dot indicator based on the message type
      const dot = document.createElement('span');
      dot.className = `activity-dot ${activity.color}`;
      
      const messageSpan = document.createElement('span');
      messageSpan.className = 'message';
      messageSpan.textContent = activity.message;
      
      const timestampSpan = document.createElement('span');
      timestampSpan.className = 'timestamp';
      timestampSpan.textContent = activity.timestamp;
      
      item.appendChild(dot);
      item.appendChild(messageSpan);
      item.appendChild(timestampSpan);
      activityList.appendChild(item);
    });
  }

  // Switch to sources tab
  function switchToSourcesTab() {
    sourcesTab.classList.add('active');
    activityTab.classList.remove('active');
    sourcesPanel.classList.remove('hidden');
    activityPanel.classList.add('hidden');
  }

  // Switch to results tab
  function switchToResultsTab() {
    resultsTitle.classList.remove('hidden');
    resultsContent.classList.remove('hidden');
  }

  // Initialize the app
  init();
});
