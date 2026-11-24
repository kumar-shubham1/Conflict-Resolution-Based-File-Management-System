
# ConflictCore — Frontend

**Project:** Conflict Resolution Based File Management System
**Team:** OSDBMS-V-2026-T206
**Institution:** Graphic Era (Deemed to be University)

## Overview

ConflictCore is a multi-user file management system integrating Operating Systems and Database Management Systems concepts.

The frontend provides a dashboard for interacting with the backend REST API and visualising file operations, process scheduling, resource locking, conflict resolution and deadlock recovery.

## Frontend Contribution

**Jahnvi Sharma — Frontend UI & Visualisation**

The frontend includes:

- Overview dashboard and backend connection status
- File explorer with folder navigation and file metadata
- File upload and file management interactions
- Process monitor with process lifecycle information
- FCFS, SJF and Priority scheduling visualisation
- Gantt chart and scheduling performance metrics
- Lock manager and FIFO waiting queues
- Wait-for graph and deadlock detection
- Deadlock simulation and recovery
- Conflict inspection and resolution interface
- File version history
- Activity log and CSV export
- Authentication and responsive navigation

## Technology Stack

- HTML5
- CSS3
- Vanilla JavaScript
- REST API integration
- JWT bearer-token authentication

## Backend Integration

The frontend communicates with the project's backend REST API.

The API base URL is configured through:

```javascript
window.CONFLICTCORE_API_BASE
```

If no custom URL is supplied, the frontend uses its default API configuration.

Authentication uses a bearer token stored in browser local storage after successful login.

The frontend integrates with backend functionality for:

- User authentication
- File and folder management
- File operations and metadata
- Process monitoring
- CPU scheduling
- Resource locks and waiting queues
- Deadlock detection and recovery
- Conflict management
- File version history
- Operation history

The backend and database are responsible for persistent records and actual file operations. The frontend presents and interacts with the available API functionality.

## Running Locally

### Prerequisites

- Node.js
- MySQL configured for the backend
- Backend dependencies installed
- Backend environment variables configured

### 1. Start the backend

From the project root, follow the backend README and start the backend server.

The default frontend API configuration expects:

```text
http://localhost:3000/api
```

### 2. Open the frontend

Open `frontend/index.html` in a modern browser.

Alternatively, use the VS Code Live Server extension.

### 3. Sign in

Use an existing backend account to authenticate.

The frontend uses the returned authentication token for protected API requests.

### 4. Test the dashboard

Verify:

- Dashboard data loads from the backend.
- Files and folders are displayed.
- Processes and scheduling information are retrieved.
- Lock and deadlock information is displayed.
- Deadlock simulation and recovery interact with the backend.
- Conflict and version-history functionality works against backend records.

## Configuration

The default API configuration is:

```javascript
const API_BASE = window.CONFLICTCORE_API_BASE ||
  (window.location.protocol === 'file:' ||
   (window.location.port && window.location.port !== '3000')
    ? 'http://localhost:3000/api'
    : '/api');
```

A custom API base URL can be supplied before loading the frontend script.

## Team Responsibilities

| Team member | Responsibility |
|---|---|
| Anshika Lakhera | Backend REST APIs and authentication |
| Avni Negi | OS process management and scheduling |
| Shubham Kumar | DBMS, database and data access layer |
| Jahnvi Sharma | Frontend UI and visualisation |

## Project Status

The frontend contains REST API integration for the project's backend services.

End-to-end functionality should be validated against the running backend and configured database environment. Any unsupported or incomplete API functionality should be documented separately rather than represented as completed.