# Model Validator Fix Plan
## Goal: Exact duplicate of chat pipeline

### Current Problems
1. ❌ Model validator uses `testModel()` + HTTP fallback
2. ❌ Different authentication path
3. ❌ Different error handling
4. ❌ Navigation broken (goes to dashboard)

### Required Fixes

#### 1. Navigation Fix (Priority: CRITICAL)
- [ ] Fix sidebar link to point to `/model-validator`
- [ ] Ensure `showPage('model-validator')` works correctly
- [ ] Verify page assembly in server.js includes model-validator

#### 2. Pipeline Alignment (Priority: CRITICAL)
The model validator MUST use the EXACT same code path as chat:

**Chat Pipeline:**
```javascript
// From js/chat.js
gateway.sendMessage(text) → 
  gateway._request('chat.send', {
    message: text,
    sessionKey: normalizeSessionKey(this.sessionKey),
    idempotencyKey: crypto.randomUUID()
  })
```

**Model Validator Must Use:**
```javascript
// Same exact call, just with test prompt
gateway.sendMessage('Hello, this is a test message. Please respond with "OK".') →
  // Same _request path, same authentication, same headers
```

#### 3. Error & Rate Limit Capture (Priority: HIGH)
Need to capture and display:
- [ ] HTTP status codes
- [ ] Response headers (especially rate limit headers)
- [ ] Error messages with full context
- [ ] WebSocket close codes
- [ ] Timing information (latency)

#### 4. Test Results Storage (Priority: MEDIUM)
Store results in test-results API with:
- [ ] Full request/response payload
- [ ] Headers captured
- [ ] Error details if failed
- [ ] Rate limit info if hit

### Implementation Steps

#### Step 1: Create New Model Validator Module
File: `js/model-validator.js`
```javascript
const ModelValidator = {
  async runTest(modelId) {
    // Save current model
    const previousModel = localStorage.getItem('selected_model');
    
    // Set test model
    localStorage.setItem('selected_model', modelId);
    
    try {
      // EXACT same call as chat
      const startTime = Date.now();
      const result = await gateway.sendMessage('Test message');
      const duration = Date.now() - startTime;
      
      // Store success result
      await this.saveResult({
        modelId,
        status: 'success',
        duration,
        response: result
      });
    } catch (error) {
      // Store error with full details
      await this.saveResult({
        modelId,
        status: 'error',
        error: {
          message: error.message,
          code: error.code,
          headers: error.headers, // Need to capture these
          raw: error
        }
      });
    } finally {
      // Restore previous model
      if (previousModel) {
        localStorage.setItem('selected_model', previousModel);
      }
    }
  }
};
```

#### Step 2: Modify Gateway Client for Test Mode
Add method to capture full request/response details:
```javascript
async sendTestMessage(text, modelId) {
  // Temporarily override model
  const originalModel = localStorage.getItem('selected_model');
  localStorage.setItem('selected_model', modelId);
  
  const startTime = Date.now();
  
  try {
    // Intercept the request to capture headers
    const result = await this._request('chat.send', {
      message: text,
      sessionKey: normalizeSessionKey(this.sessionKey),
      idempotencyKey: crypto.randomUUID()
    });
    
    return {
      success: true,
      duration: Date.now() - startTime,
      result
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: {
        message: error.message,
        code: error.code,
        // Extract any rate limit info from error
        rateLimitInfo: this.extractRateLimitInfo(error)
      }
    };
  } finally {
    // Restore original model
    if (originalModel) {
      localStorage.setItem('selected_model', originalModel);
    } else {
      localStorage.removeItem('selected_model');
    }
  }
}
```

#### Step 3: Update Model Validator Page
Replace the entire model-validator.html content with:
- Clean UI showing model list
- Test button for each model
- Results panel showing:
  - Status (pass/fail/rate-limited)
  - Latency
  - Full error details if failed
  - Rate limit info if hit
  - Raw response

#### Step 4: Fix Navigation
Update sidebar to correctly link to model-validator page.

### Testing Checklist
- [ ] Clicking model validator in sidebar navigates to correct page
- [ ] Running test uses same auth as chat
- [ ] Rate limits detected and displayed
- [ ] Errors show full details (same as chat would show)
- [ ] Results saved to test-results API
- [ ] Can view test history

### Files to Modify
1. `js/model-validator.js` - Create new module
2. `gateway-client.js` - Add test method with full capture
3. `pages/model-validator.html` - Redesign with exact duplicate pipeline
4. `partials/sidebar.html` - Fix navigation link
5. `server.js` - Ensure route is correct

### Success Criteria
✅ Model validator uses EXACT same code path as chat
✅ Same authentication, headers, error handling
✅ Same rate limit detection
✅ Same error messages
✅ Navigation works correctly
✅ Results are comprehensive and actionable
