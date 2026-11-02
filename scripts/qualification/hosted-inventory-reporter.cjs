class HostedInventoryReporter {
  onBegin(_config, suite) {
    console.log('INVENTORY_DIAGNOSTIC_SELECTED ' + JSON.stringify({ count: suite.allTests().length }));
  }
  onTestEnd(_test, result) {
    const allowed = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
    console.log('INVENTORY_DIAGNOSTIC_CASE ' + JSON.stringify({
      status: allowed.includes(result.status) ? result.status : 'unknown',
      durationMs: Math.max(0, Math.round(result.duration || 0)),
    }));
  }
  onError() {
    // Do not print error text, paths, screenshots, selectors or page contents.
    console.log('INVENTORY_DIAGNOSTIC_RUNNER_ERROR');
  }
  onEnd(result) {
    const allowed = ['passed', 'failed', 'timedout', 'interrupted'];
    console.log('INVENTORY_DIAGNOSTIC_COMPLETE ' + JSON.stringify({
      status: allowed.includes(result.status) ? result.status : 'unknown',
    }));
  }
}
module.exports = HostedInventoryReporter;
