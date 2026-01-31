# Debug Missing Messages

## Step 1: Check the state arrays
Open browser console (F12) and run these commands:

```javascript
// How many messages are in each array?
console.log('Chat messages:', state.chat.messages.length);
console.log('System messages:', state.system.messages.length);

// Show the actual messages
console.log('Chat:', state.chat.messages);
console.log('System:', state.system.messages);
```

## Step 2: Check if Gateway is connected
```javascript
console.log('Connected?', gateway?.isConnected());
console.log('Session:', gateway?.sessionKey);
```

## Step 3: Try sending a test message
1. Type a message in the chat input
2. Click Send
3. Watch the console for these logs:
   - `[addLocalChatMessage]` - shows where it's routing
   - `[renderChat]` - shows how many messages it's rendering

## Step 4: Check Gateway history
```javascript
// Manually load history to see what's in there
gateway.loadHistory().then(result => {
    console.log('Gateway history:', result);
    console.log('Message count:', result?.messages?.length);
});
```

---

## What to look for:

**If `state.chat.messages.length` is 0 but `state.system.messages.length` has messages:**
→ The filter is too aggressive, all messages classified as system

**If both are 0:**
→ Messages aren't being added at all (Gateway issue or loading issue)

**If messages exist but you don't see them:**
→ Rendering issue

**If console shows errors:**
→ JavaScript error breaking the flow

Run these commands and tell me what you see!
