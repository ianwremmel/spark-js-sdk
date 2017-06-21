/* eslint-disable func-names */
/* eslint-disable global-require */
/* eslint-disable require-jsdoc */

// eslint-disable-next-line strict
'use strict';

const makeBrowsers = require(`./browsers-ng`);
/* eslint-disable global-require */

module.exports = function configureKarma(config) {
  config.set(makeConfig(process.env.PACKAGE));
};

module.exports.makeConfig = makeConfig;
function makeConfig(packageName, argv) {
  const pkg = require(`./packages/node_modules/${packageName}/package`);
  /* eslint complexity: [0] */
  const launchers = makeBrowsers(packageName, argv);

  const preprocessors = {};

  const files = [];

  if (!argv || argv.unit) {
    const unitTestPath = `packages/node_modules/${packageName}/test/unit/spec/**/*.js`;
    files.push(unitTestPath);
    preprocessors[unitTestPath] = [`browserify`];
  }
  if (!argv || argv.integration) {
    const integrationTestPath = `packages/node_modules/${packageName}/test/integration/spec/**/*.js`;
    files.push(integrationTestPath);
    preprocessors[integrationTestPath] = [`browserify`];
  }

  let cfg = {
    autoWatch: argv && argv.karmaDebug,

    basePath: `.`,

    browserDisconnectTimeout: 10000,

    browserDisconnectTolerance: 3,

    browsers: Object.keys(launchers),

    browserify: {
      debug: true,
      watch: argv && argv.karmaDebug
    },

    browserNoActivityTimeout: 240000,

    // Inspired by Angular's karma config as recommended by Sauce Labs
    captureTimeout: 0,

    colors: !(argv && argv.xunit),

    concurrency: 3,

    customLaunchers: launchers,

    files,

    frameworks: [
      `browserify`,
      `mocha`
    ],

    hostname: `127.0.0.1`,

    client: {
      mocha: {
        // TODO figure out how to report retries
        retries: process.env.JENKINS || process.env.CI ? 1 : 0,
        timeout: 30000,
        grep: argv && argv.grep[0]
      }
    },

    mochaReporter: {
      // Hide the skipped tests on jenkins to more easily see which tests failed
      ignoreSkipped: true
    },

    port: parseInt(process.env.KARMA_PORT, 10) || 9001,

    preprocessors,

    proxies: {
      '/fixtures/': `http://127.0.0.1:${process.env.FIXTURE_PORT}/`,
      '/upload': `http://127.0.0.1:${process.env.FIXTURE_PORT}/upload`
    },

    reporters: [
      `mocha`
    ],

    singleRun: !(argv && argv.karmaDebug),

    // video and screenshots add on the request of sauce labs support to help
    // diagnose test user creation timeouts
    recordVideo: true,
    recordScreenshots: true
  };

  if (process.env.SC_TUNNEL_IDENTIFIER) {
    cfg.sauceLabs = {
      build: process.env.BUILD_NUMBER || `local-${process.env.USER}-${packageName}-${Date.now()}`,
      startConnect: false,
      testName: `${pkg.name} (karma)`,
      tunnelIdentifier: process.env.SC_TUNNEL_IDENTIFIER,
      recordScreenshots: true,
      recordVideo: true
    };
    cfg.reporters.push(`saucelabs`);
  }

  if (argv && argv.xunit) {
    cfg.junitReporter = {
      outputFile: `${packageName}.xml`,
      outputDir: `reports/junit/karma`,
      suite: packageName,
      useBrowserName: true,
      recordScreenshots: true,
      recordVideo: true
    };

    cfg.reporters.push(`junit`);
  }

  try {
    cfg = require(`./packages/node_modules/${packageName}/karma.conf.js`)(cfg);
  }
  catch (error) {
    // ignore
  }

  return cfg;
}
