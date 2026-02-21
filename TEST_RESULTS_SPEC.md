# Test Results Dashboard - Implementation Spec

## Overview
Build a test results dashboard for the Dashboard Tester to save, view, copy, and download test results.

## Storage
- **Location:** `/home/solo/.openclaw/workspace/repos/solobot-dashboard/test-results.json`
- **Format:** JSON array of test result objects
- **Persistence:** Local file (no backend required)

## Test Result Data Model

```json
{
  "id": "uuid-v4",
  "timestamp": "2026-02-21T10:50:00.000Z",
  "testType": "agent-message",
  "status": "pass|fail|timeout|rate-limited",
  "durationMs": 1234,
  "request": {
    "sessionKey": "agent:dev:main",
    "message": "Hello"
  },
  "response": {
    "content": "Hi there!",
    "model": "kimi-k2.5"
  },
  "rateLimitInfo": {
    "hit": true,
    "retryAfter": 60,
    "limit": 100,
    "remaining": 0,
    "resetTime": "2026-02-21T10:51:00.000Z"
  },
  "sessionKey": "test-session-123",
  "targetAgent": "agent:dev:main",
  "notes": "Optional user notes"
}
```

## Test Types
1. **gateway-connect** — WebSocket connection test
2. **agent-message** — Send message to agent, capture response
3. **latency** — Round-trip time measurement
4. **session-persist** — Session key reuse test

## Status Values
- `pass` — Test completed successfully
- `fail` — Test failed (error response)
- `timeout` — Test exceeded time limit
- `rate-limited` — Hit rate limit, includes cooldown info

## UI Requirements

### 1. Test Results Page (`test-results.html`)
- Full-page view accessible from dashboard nav
- **Header:** Title + "Run New Test" button + "Export All" button
- **Filters:** 
  - Date range picker
  - Test type dropdown
  - Status dropdown (multi-select)
  - Search by session key or agent
- **Table columns:**
  - Timestamp (sortable)
  - Test Type (sortable)
  - Status (badge with color)
  - Duration (ms)
  - Target Agent
  - Actions (View, Copy JSON, Download)
- **Status badges:**
  - Pass = green
  - Fail = red
  - Timeout = orange
  - Rate-limited = yellow with clock icon

### 2. Rate Limit Display
When viewing a rate-limited test:
- Show "Rate Limited" badge
- Display "Available again at: [time]" or countdown timer
- Show retry-after duration

### 3. Actions
- **View:** Modal with full JSON details, formatted
- **Copy JSON:** Copies raw JSON to clipboard, shows toast confirmation
- **Download:** Saves individual test as `.json` file
- **Export All:** Downloads entire `test-results.json` file

### 4. Run Test Flow
- Select test type from dropdown
- Configure parameters (agent, session key, message)
- Run test with visual spinner
- Save result automatically on completion
- Show result immediately in table

## Files to Create

```
solobot-dashboard/
├── test-results.html          # Main page
├── css/
│   └── test-results.css       # Styles
├── js/
│   ├── test-results.js        # Data layer + UI logic
│   └── test-runner.js         # Test execution
└── test-results.json          # Data file (gitignored)
```

## Integration Points

### Navigation
Add to dashboard sidebar/nav:
```html
<a href="test-results.html">
  <span class="icon">🧪</span> Test Results
</a>
```

### From Testing Tab
After running a test in the existing Testing tab:
```javascript
// Auto-save result
TestResults.save({
  testType: 'agent-message',
  status: response.ok ? 'pass' : 'fail',
  durationMs: endTime - startTime,
  request: { sessionKey, message },
  response: responseData,
  rateLimitInfo: extractRateLimitInfo(response)
});
```

## Acceptance Criteria
- [ ] Results save to JSON file automatically after each test
- [ ] View all previous tests in sortable/filterable table
- [ ] Copy any result as JSON to clipboard
- [ ] Download individual result or all results
- [ ] Rate-limited tests show cooldown info clearly
- [ ] Clean, intuitive UI matching dashboard style
- [ ] Works without backend (local file only)

## Priority
HIGH — SoLo is waiting for this feature.
