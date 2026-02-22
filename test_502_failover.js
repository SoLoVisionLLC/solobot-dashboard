const helpers = require('/home/linuxbrew/.linuxbrew/lib/node_modules/openclaw/dist/pi-embedded-helpers-CMf7l1vP.js');

const mockHtml502 = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>';
const mockNumeric502 = '502 Bad Gateway';

console.log("Testing HTML 502...");
const isHtmlCloudflare = helpers.isCloudflareOrHtmlErrorPage(mockHtml502);
const isHtmlTransient = helpers.isTransientHttpError(mockHtml502);
console.log(`isCloudflareOrHtmlErrorPage: ${isHtmlCloudflare} (Expected: true)`);
console.log(`isTransientHttpError: ${isHtmlTransient} (Expected: true)`);

console.log("\nTesting Numeric 502...");
const isNumCloudflare = helpers.isCloudflareOrHtmlErrorPage(mockNumeric502);
const isNumTransient = helpers.isTransientHttpError(mockNumeric502);
console.log(`isCloudflareOrHtmlErrorPage: ${isNumCloudflare} (Expected: true)`);
console.log(`isTransientHttpError: ${isNumTransient} (Expected: true)`);

const reason = helpers.classifyFailoverReason(mockHtml502);
console.log(`\nclassifyFailoverReason: ${reason} (Expected: timeout)`);

if (isHtmlTransient && isNumTransient && reason === 'timeout') {
    console.log("\n✅ VERIFICATION SUCCESSFUL");
} else {
    console.log("\n❌ VERIFICATION FAILED");
    process.exit(1);
}
