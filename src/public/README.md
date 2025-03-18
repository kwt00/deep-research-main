# Deep Research UI

This is the UI for the Deep Research library. It provides a clean, modern interface for interacting with the Deep Research API to perform web research on various topics.

## Features

- Simple, intuitive interface for research queries
- Real-time status updates and progress tracking
- Activity log to monitor the research process
- Sources panel to view all visited URLs
- Markdown formatting support for research results

## Getting Started

1. Ensure you have Node.js 22.x installed (as specified in the project's package.json)
2. Install dependencies with `npm install`
3. Make sure you have a valid Firecrawl API key set in `.env.local`
4. Start the server with `npm run api`
5. Open your browser to `http://localhost:3051`

## API Endpoints

- `POST /api/research` - Submit a research query
  - Request body: `{ query: string, depth?: number, breadth?: number }`
  - Response: `{ success: boolean, answer: string, learnings: string[], visitedUrls: string[] }`

## Project Structure

- `/src/public` - Static files for the UI
  - `index.html` - Main HTML file
  - `styles.css` - CSS styles
  - `app.js` - JavaScript for the UI
  - `*.svg` - SVG icons
- `/src` - Server and Deep Research implementation
  - `api.ts` - Express server with API endpoints
  - `deep-research.ts` - Core research functionality

## How to Use

1. Enter your research query in the input field at the bottom of the page
2. Press Enter or click the send button to start the research
3. View real-time progress in the status bar
4. Once complete, view the results and check the Sources tab for references

## Environment Variables

- `FIRECRAWL_KEY` - Your Firecrawl API key
- `PORT` - (Optional) Port for the server (default: 3051)
