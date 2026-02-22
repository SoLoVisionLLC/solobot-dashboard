import * as helpers from '/home/linuxbrew/.linuxbrew/lib/node_modules/openclaw/dist/pi-embedded-helpers-CMf7l1vP.js';

const mockHtml502 = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>';
const mockNumeric502 = '502 Bad Gateway';

console.log("Testing HTML 502...");
// A = isTransientHttpError, m = classifyFailoverReason
const isHtmlTransient = helpers.A(mockHtml502);
console.log(`isTransientHttpError: ${isHtmlTransient} (Expected: true)`);

const reason = helpers.m(mockHtml502);
console.log(`classifyFailoverReason: ${reason} (Expected: timeout)`);

console.log("\nTesting Numeric 502...");
const isNumTransient = helpers.A(mockNumeric502);
console.log(`isTransientHttpError: ${isNumTransient} (Expected: true)`);

if (isHtmlTransient && isNumTransient && reason === 'timeout') {
    console.log("\n✅ VERIFICATION SUCCESSFUL");
} else {
    console.log("\n❌ VERIFICATION FAILED");
    process.exit(1);
}
