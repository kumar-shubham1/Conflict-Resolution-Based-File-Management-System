# ConflictCore — Frontend & Visualisation

**Project:** Conflict Resolution Based File Management System
**Team:** OSDBMS-V-2026-T206
**Institution:** Graphic Era (Deemed to be University)

## Overview

ConflictCore is a Project-Based Learning project combining Operating Systems and Database Management Systems concepts to demonstrate file operations, process scheduling, concurrent access, locks, and deadlock handling.

## Contribution

**Jahnvi Sharma — Frontend UI & Visualisation**

This repository contains the frontend demonstration interface for ConflictCore, including:

- Overview dashboard with file, process, lock and deadlock summary cards
- File explorer with search, filters, folder creation, local file listing and file-action demonstrations
- Process monitor with lifecycle states and operation details
- FCFS, SJF and Priority scheduling visualisation, Gantt timeline and waiting/turnaround/response metrics
- File lock registry and waiting queue view
- Wait-for graph and deadlock recovery demonstration
- Activity log with CSV export
- Responsive navigation, dialogs, status indicators and toast feedback

## Technology

- HTML5
- CSS3 (responsive layout and custom styling)
- Vanilla JavaScript

## Run locally

No build tools or package installation are required.

1. Download or clone this repository.
2. Open `index.html` in a modern browser.

Alternatively, open the folder in VS Code and use the Live Server extension.

## Important implementation note

The current UI is a standalone frontend demonstration using sample data. It does not yet connect to the team's backend, MySQL database, or OS kernel. File uploads only add selected filenames to the local page; they are not uploaded to a server. File actions, process creation, scheduler calculations, and deadlock recovery interactions are local demonstrations and do not modify real backend records or operating-system processes. Backend integration will be added according to the team's agreed integration plan.

## Team responsibilities

| Team member | Responsibility |
|---|---|
| Anshika Lakhera | Backend REST APIs and authentication |
| Avni Negi | OS process manager and scheduling |
| Shubham Kumar | DBMS, database and data access layer |
| Jahnvi Sharma | Frontend UI and visualisation |

## Project status

Frontend demonstration implementation created. API/database/OS integration is pending team coordination.
