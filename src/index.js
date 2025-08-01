import React from 'react';
import ReactDOM from 'react-dom/client'; // Import createRoot from 'react-dom/client' for React 18+
import './index.css'; // Import your global CSS file
import App from './App'; // Import your main App component

// Get the root DOM element where your React app will be mounted
const root = ReactDOM.createRoot(document.getElementById('root'));

// Render your App component into the root element
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
