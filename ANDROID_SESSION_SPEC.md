# Android App - Persistent Sub-Agent Sessions

This document describes what the Android app needs to implement to match the web dashboard's persistent sub-agent session behavior.

## Overview

Each sub-agent now has a persistent "main" session (e.g., `agent:dev:main`, `agent:cmp:main`), similar to how `agent:main:main` works for SoLoBot. When clicking an agent in the sidebar, the app should:

1. Connect to that agent's main session
2. Filter the sessions dropdown to only show that agent's sessions
3. Allow spawning new sessions for that specific agent

## Session Key Format

Session keys follow the pattern: `agent:{agentId}:{sessionName}`

Examples:
- `agent:main:main` - SoLoBot's main session
- `agent:dev:main` - DEV's main session
- `agent:cfo:main` - CFO's main session
- `agent:dev:bugfix-2024-02` - A DEV one-off session

## Agent IDs

| Agent ID | Display Name |
|----------|--------------|
| `main` | SoLoBot |
| `exec` | EXEC Orchestrator |
| `coo` | COO |
| `cfo` | CFO |
| `cmp` | CMP |
| `dev` | DEV |
| `family` | Family Coordinator |
| `tax` | Tax Compliance |

## Behavior Changes

### 1. Agent Selection (Sidebar Click)

When user taps an agent in the sidebar:

```kotlin
fun onAgentSelected(agentId: String) {
    // Update current agent context
    currentAgentId = agentId
    
    // Build the main session key for this agent
    val sessionKey = "agent:$agentId:main"
    
    // Switch to chat view with this session
    switchToSession(sessionKey)
    
    // Update UI to highlight selected agent
    updateSelectedAgentUI(agentId)
    
    // Refresh sessions dropdown filtered for this agent
    refreshSessionsDropdown()
}
```

### 2. Sessions Dropdown - Filter by Agent

When populating the sessions dropdown, filter to only show sessions belonging to the current agent:

```kotlin
fun getAgentIdFromSession(sessionKey: String): String {
    val regex = Regex("^agent:([^:]+):")
    val match = regex.find(sessionKey)
    return match?.groupValues?.get(1) ?: "main"
}

fun getFilteredSessions(allSessions: List<Session>, agentId: String): List<Session> {
    return allSessions.filter { session ->
        getAgentIdFromSession(session.key) == agentId
    }
}
```

### 3. Dropdown Header with "New Session" Button

The dropdown should include:
- Header showing which agent's sessions are being displayed
- A "+ New" button to spawn a new session for that agent

```xml
<!-- Dropdown header -->
<LinearLayout orientation="horizontal">
    <TextView text="DEV Sessions" /> <!-- Dynamic based on agent -->
    <Button text="+ New" onClick="startNewAgentSession" />
</LinearLayout>

<!-- Sessions list (filtered) -->
<RecyclerView adapter="filteredSessionsAdapter" />
```

### 4. Creating New Agent Sessions

When user taps "+ New" in the dropdown:

```kotlin
fun startNewAgentSession(agentId: String) {
    val timestamp = SimpleDateFormat("MM-dd-HHmm").format(Date())
    val agentLabel = getAgentLabel(agentId)
    val defaultName = "$agentLabel-$timestamp"
    
    // Show input dialog for session name
    showInputDialog(
        title = "New $agentLabel Session",
        default = defaultName,
        onConfirm = { sessionName ->
            val sessionKey = "agent:$agentId:$sessionName"
            createAndSwitchToSession(sessionKey)
        }
    )
}

fun getAgentLabel(agentId: String): String {
    return when (agentId) {
        "main" -> "SoLoBot"
        "exec" -> "EXEC"
        "coo" -> "COO"
        "cfo" -> "CFO"
        "cmp" -> "CMP"
        "dev" -> "DEV"
        "family" -> "Family"
        "tax" -> "Tax"
        else -> agentId.uppercase()
    }
}
```

### 5. State to Track

Add these to your app state:

```kotlin
// Current agent context (default to "main")
var currentAgentId: String = "main"

// All sessions from gateway
var allSessions: List<Session> = emptyList()

// Filtered sessions for current agent (computed)
val filteredSessions: List<Session>
    get() = getFilteredSessions(allSessions, currentAgentId)
```

### 6. UI Updates

When switching agents or sessions, update:

1. **Sidebar**: Highlight the active agent
2. **Chat Header**: Show agent name (e.g., "DEV" or "SoLoBot")
3. **Session Badge**: Show current session name (e.g., "main" or "bugfix-2024-02")
4. **Sessions Dropdown**: Filter to current agent's sessions only

## Gateway API Notes

- Sessions are fetched via `gateway.listSessions({})` RPC
- Session keys come in the `key` field
- The gateway handles session creation automatically when you connect with a new session key
- No explicit "create session" API is needed - just connect to the new key

## Migration Notes

If the app currently shows all sessions in the dropdown:
1. Add `currentAgentId` tracking
2. Add filtering logic to `getFilteredSessions()`
3. Extract agent ID when switching sessions
4. Update dropdown population to use filtered list
5. Add agent label display in chat header

## Testing

Verify these scenarios:
1. Click DEV in sidebar → connects to `agent:dev:main`
2. Sessions dropdown shows only DEV sessions (not main/coo/etc)
3. Click "+ New" → creates `agent:dev:{name}` and connects
4. Click CFO in sidebar → switches agent context, shows CFO sessions
5. Session created for DEV doesn't appear in CFO dropdown
