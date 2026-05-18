// Segment's schema filter is kept as an inert shim for the same dynamic import
// path, but it deliberately does nothing.
function schemaFilter(planTrackRules, analyticsContext) {
  void planTrackRules;
  void analyticsContext;
  return Promise.resolve();
}

export { schemaFilter as t };
