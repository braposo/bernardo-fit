// Let Playwright resolve its own browser build and Linux dependencies. Trigger
// 4.5's bundled extension parses a dry-run format that Playwright no longer emits.
export function cvBrowserExtension() {
  return {
    name: 'cv-playwright-browser',
    externalsForTarget: target => target === 'dev' ? [] : ['playwright'],
    onBuildComplete(context, manifest) {
      if (context.target === 'dev') return;
      const version = manifest.externals?.find(pkg => pkg.name === 'playwright')?.version;
      if (!/^\d+\.\d+\.\d+$/.test(version || ''))
        throw new Error('A resolved Playwright version is required for the CV browser image.');
      context.addLayer({
        id: 'cv-playwright-browser',
        image: {instructions: [
          'RUN apt-get update && apt-get install -y --no-install-recommends npm ca-certificates',
          `RUN npm install -g playwright@${version}`,
          'RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright playwright install --with-deps --only-shell chromium',
        ]},
        deploy: {env: {PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright'}, override: true},
        dependencies: {playwright: version},
      });
    },
  };
}
