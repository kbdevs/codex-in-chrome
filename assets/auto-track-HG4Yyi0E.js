// The analytics auto-track helpers are preserved as no-op methods so the
// bundled analytics runtime can import them without wiring click or submit
// tracking on the reconstructed source tree.
function link(target, href, options) {
  void href;
  void options;
  return target;
}

function form(target, submitHandler, properties, options) {
  void submitHandler;
  void properties;
  void options;
  return target;
}

export { form, link };
