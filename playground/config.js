// Deployment settings. The SDK key is public by design: it ships in every page
// that loads the SDK. Use a dedicated demo account so playground traffic stays
// out of a customer's Risk Monitoring.
window.PLAYGROUND_CONFIG = {
  sdkKey: "YOUR_SDK_KEY",
  sdkUrl: "https://d37t6u7aogmv50.cloudfront.net/v3.2.3/dist/deepvue-imprint.min.js",
  signUpUrl: "https://dashboard.deepvue.ai/sign-up",
  setupGuideUrl: "https://dashboard.deepvue.ai/intelligence/device-intelligence/setup",
};
