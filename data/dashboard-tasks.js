// Add all 70 dashboard improvement tasks from 16 phases
// This script adds tasks to the SoLoBot Command Center Dashboard

const dashboardTasks = [
    // Phase 1: Visual Design Foundation (P0)
    { phase: 1, title: "[P1] Implement glassmorphism cards with blur effect", priority: 0 },
    { phase: 1, title: "[P1] Add sparklines for Quick Stats widget (mini trend graphs)", priority: 0 },
    { phase: 1, title: "[P1] Replace progress bars with circular progress rings", priority: 0 },
    { phase: 1, title: "[P1] Add mini heatmaps for activity patterns", priority: 0 },
    
    // Phase 2: Motion & Microinteractions (P0)
    { phase: 2, title: "[P2] Widget fade-in animations when data updates", priority: 0 },
    { phase: 2, title: "[P2] Hover state lift effects on cards", priority: 0 },
    { phase: 2, title: "[P2] Drag-and-drop snap animations", priority: 0 },
    { phase: 2, title: "[P2] Loading shimmer effect (replace spinners)", priority: 0 },
    
    // Phase 3: Widget System (P0)
    { phase: 3, title: "[P3] Make widgets resizable/minimizable", priority: 0 },
    { phase: 3, title: "[P3] Save layout preferences per user", priority: 0 },
    { phase: 3, title: "[P3] Drag-to-rearrange bento grid", priority: 0 },
    { phase: 3, title: "[P3] Focus mode that hides all except active tasks", priority: 0 },
    
    // Phase 4: Context Awareness (P1)
    { phase: 4, title: "[P4] Time-of-day layout switching (morning/deep work)", priority: 1 },
    { phase: 4, title: "[P4] Agent-aware layouts (DEV shows terminal, COO shows tasks)", priority: 1 },
    { phase: 4, title: "[P4] Workflow-aware widget expansion", priority: 1 },
    
    // Phase 5: Command Palette (Cmd+K) (P1)
    { phase: 5, title: "[P5] Universal search to jump pages/widgets", priority: 1 },
    { phase: 5, title: "[P5] Quick actions: create task, switch agent", priority: 1 },
    { phase: 5, title: "[P5] Search chat history, notes, memory", priority: 1 },
    
    // Phase 6: AI Insights Widget (P1)
    { phase: 6, title: "[P6] Weekly task completion summary", priority: 1 },
    { phase: 6, title: "[P6] Agent idle time alerts", priority: 1 },
    { phase: 6, title: "[P6] Pattern-based suggestions", priority: 1 },
    { phase: 6, title: "[P6] Natural language summaries", priority: 1 },
    
    // Phase 7: Activity Visualization (P1)
    { phase: 7, title: "[P7] Live timeline with icons (replace text log)", priority: 1 },
    { phase: 7, title: "[P7] Hour/day heatmap", priority: 1 },
    { phase: 7, title: "[P7] Message volume sparkline", priority: 1 },
    { phase: 7, title: "[P7] Agent presence indicators", priority: 1 },
    
    // Phase 8: Quick Actions (P1)
    { phase: 8, title: "[P8] Inline task creation in kanban", priority: 1 },
    { phase: 8, title: "[P8] Quick note input without modal", priority: 1 },
    { phase: 8, title: "[P8] One-click agent switch", priority: 1 },
    { phase: 8, title: "[P8] Built-in Pomodoro timer", priority: 1 },
    
    // Phase 9: Voice Integration (P2)
    { phase: 9, title: "[P9] Voice commands for dashboard actions", priority: 2 },
    { phase: 9, title: "[P9] Audio notifications for events", priority: 2 },
    { phase: 9, title: "[P9] Voice memos with transcription", priority: 2 },
    
    // Phase 10: Task Board Enhancements (P2)
    { phase: 10, title: "[P10] Swimlane view (group by agent/priority)", priority: 2 },
    { phase: 10, title: "[P10] Bulk selection improvements", priority: 2 },
    { phase: 10, title: "[P10] Due date visual indicators (red pulse for overdue)", priority: 2 },
    { phase: 10, title: "[P10] Task dependency connecting lines", priority: 2 },
    
    // Phase 11: Agent Status Panel (P2)
    { phase: 11, title: "[P11] Traffic light indicators (green/yellow/red)", priority: 2 },
    { phase: 11, title: "[P11] Mini sparklines per agent activity", priority: 2 },
    { phase: 11, title: "[P11] Handoff button between agents", priority: 2 },
    { phase: 11, title: "[P11] Resource usage display (tokens, runtime)", priority: 2 },
    
    // Phase 12: Analytics Widget (P2)
    { phase: 12, title: "[P12] Token usage over time (line chart)", priority: 2 },
    { phase: 12, title: "[P12] Cost breakdown by agent (donut chart)", priority: 2 },
    { phase: 12, title: "[P12] Session duration heatmap", priority: 2 },
    { phase: 12, title: "[P12] Week-over-week comparison", priority: 2 },
    
    // Phase 13: Terminal Improvements (P2)
    { phase: 13, title: "[P13] Resizable/dockable terminal", priority: 2 },
    { phase: 13, title: "[P13] Syntax highlighting for output", priority: 2 },
    { phase: 13, title: "[P13] Command history with up-arrow", priority: 2 },
    { phase: 13, title: "[P13] Clear on new session toggle", priority: 2 },
    
    // Phase 14: UX Polish (P2)
    { phase: 14, title: "[P14] Zero-state designs with CTAs", priority: 2 },
    { phase: 14, title: "[P14] Empty state illustrations", priority: 2 },
    { phase: 14, title: "[P14] Mobile-responsive bento (1/2/3 columns)", priority: 2 },
    { phase: 14, title: "[P14] Touch-friendly drag handles", priority: 2 },
    
    // Phase 15: Keyboard Shortcuts (P2)
    { phase: 15, title: "[P15] 1-9: switch to agent N", priority: 2 },
    { phase: 15, title: "[P15] T: new task", priority: 2 },
    { phase: 15, title: "[P15] N: new note", priority: 2 },
    { phase: 15, title: "[P15] C: focus chat", priority: 2 },
    { phase: 15, title: "[P15] Esc: clear selection", priority: 2 },
    
    // Phase 16: Business Features (P2)
    { phase: 16, title: "[P16] Goals/OKR tracking widget", priority: 2 },
    { phase: 16, title: "[P16] Weekly/monthly goal progress", priority: 2 },
    { phase: 16, title: "[P16] Business metrics health check", priority: 2 },
    { phase: 16, title: "[P16] Time tracking integration", priority: 2 },
    { phase: 16, title: "[P16] Auto-log time per agent/task", priority: 2 },
    { phase: 16, title: "[P16] Weekly productivity report", priority: 2 },
    { phase: 16, title: "[P16] Decision log with context", priority: 2 },
    { phase: 16, title: "[P16] Link decisions to tasks/outcomes", priority: 2 }
];

// Export for use in dashboard
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dashboardTasks };
}
