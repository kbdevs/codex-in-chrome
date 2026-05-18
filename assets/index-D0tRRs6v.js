// Segment's query-string helper is kept as an inert shim so the dynamic import
// path still resolves, but no analytics events are emitted from localhost tests.
function queryString(analyticsClient, pageUrl) {
  void analyticsClient;
  void pageUrl;
  return Promise.resolve();
}

export { queryString as e };
