/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {normalizeUrl, posixPath} from '@docusaurus/utils';
import logger from '@docusaurus/logger';
import chokidar from 'chokidar';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import path from 'path';
import _ from 'lodash';
import openBrowser from 'react-dev-utils/openBrowser';
import {prepareUrls} from 'react-dev-utils/WebpackDevServerUtils';
import evalSourceMapMiddleware from 'react-dev-utils/evalSourceMapMiddleware';
import webpack from 'webpack';
import WebpackDevServer from 'webpack-dev-server';
import merge from 'webpack-merge';
import {load} from '../server';
import type {StartCLIOptions} from '@docusaurus/types';
import createClientConfig from '../webpack/client';
import {
  applyConfigureWebpack,
  applyConfigurePostCss,
  getHttpsConfig,
} from '../webpack/utils';
import {getCLIOptionHost, getCLIOptionPort} from './commandUtils';
import {getTranslationsLocaleDirPath} from '../server/translations/translations';

export async function start(
  siteDir: string,
  cliOptions: Partial<StartCLIOptions>,
): Promise<void> {
  process.env.NODE_ENV = 'development';
  process.env.BABEL_ENV = 'development';
  logger.info('Starting the development server...');

  function loadSite() {
    return load({
      siteDir,
      customConfigFilePath: cliOptions.config,
      locale: cliOptions.locale,
      localizePath: undefined, // Should this be configurable?
    });
  }

  // Process all related files as a prop.
  const props = await loadSite();

  const protocol: string = process.env.HTTPS === 'true' ? 'https' : 'http';

  const host: string = getCLIOptionHost(cliOptions.host);
  const port: number | null = await getCLIOptionPort(cliOptions.port, host);

  if (port === null) {
    process.exit();
  }

  const {baseUrl, headTags, preBodyTags, postBodyTags} = props;
  const urls = prepareUrls(protocol, host, port);
  const openUrl = normalizeUrl([urls.localUrlForBrowser, baseUrl]);

  logger.success`Docusaurus website is running at url=${openUrl}.`;

  // Reload files processing.
  const reload = _.debounce(() => {
    loadSite()
      .then(({baseUrl: newBaseUrl}) => {
        const newOpenUrl = normalizeUrl([urls.localUrlForBrowser, newBaseUrl]);
        if (newOpenUrl !== openUrl) {
          logger.success`Docusaurus website is running at url=${newOpenUrl}.`;
        }
      })
      .catch((err) => {
        logger.error(err.stack);
      });
  }, 500);
  const {siteConfig, plugins} = props;

  const normalizeToSiteDir = (filepath: string) => {
    if (filepath && path.isAbsolute(filepath)) {
      return posixPath(path.relative(siteDir, filepath));
    }
    return posixPath(filepath);
  };

  const pluginPaths = plugins
    .flatMap((plugin) => plugin.getPathsToWatch?.() ?? [])
    .filter(Boolean)
    .map(normalizeToSiteDir);

  const pathsToWatch = [
    ...pluginPaths,
    props.siteConfigPath,
    getTranslationsLocaleDirPath({
      siteDir,
      locale: props.i18n.currentLocale,
    }),
  ];

  const pollingOptions = {
    usePolling: !!cliOptions.poll,
    interval: Number.isInteger(cliOptions.poll)
      ? (cliOptions.poll as number)
      : undefined,
  };
  const httpsConfig = await getHttpsConfig();
  const fsWatcher = chokidar.watch(pathsToWatch, {
    cwd: siteDir,
    ignoreInitial: true,
    ...{pollingOptions},
  });

  ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach((event) =>
    fsWatcher.on(event, reload),
  );

  let config: webpack.Configuration = merge(await createClientConfig(props), {
    watchOptions: {
      ignored: /node_modules\/(?!@docusaurus)/,
      poll: cliOptions.poll,
    },
    infrastructureLogging: {
      // Reduce log verbosity, see https://github.com/facebook/docusaurus/pull/5420#issuecomment-906613105
      level: 'warn',
    },
    plugins: [
      // Generates an `index.html` file with the <script> injected.
      new HtmlWebpackPlugin({
        template: path.join(
          __dirname,
          '../webpack/templates/index.html.template.ejs',
        ),
        // So we can define the position where the scripts are injected.
        inject: false,
        filename: 'index.html',
        title: siteConfig.title,
        headTags,
        preBodyTags,
        postBodyTags,
      }),
    ],
  });

  // Plugin Lifecycle - configureWebpack and configurePostCss.
  plugins.forEach((plugin) => {
    const {configureWebpack, configurePostCss} = plugin;

    if (configurePostCss) {
      config = applyConfigurePostCss(configurePostCss.bind(plugin), config);
    }

    if (configureWebpack) {
      config = applyConfigureWebpack(
        configureWebpack.bind(plugin), // The plugin lifecycle may reference `this`.
        config,
        false,
        props.siteConfig.webpack?.jsLoader,
        plugin.content,
      );
    }
  });

  const compiler = webpack(config);
  if (process.env.E2E_TEST) {
    compiler.hooks.done.tap('done', (stats) => {
      if (stats.hasErrors()) {
        logger.error('E2E_TEST: Project has compiler errors.');
        process.exit(1);
      }
      logger.success('E2E_TEST: Project can compile.');
      process.exit(0);
    });
  }

  // https://webpack.js.org/configuration/dev-server
  const defaultDevServerConfig: WebpackDevServer.Configuration = {
    hot: cliOptions.hotOnly ? 'only' : true,
    liveReload: false,
    client: {
      progress: true,
      overlay: {
        warnings: false,
        errors: true,
      },
    },
    headers: {
      'access-control-allow-origin': '*',
    },
    devMiddleware: {
      publicPath: baseUrl,
      // Reduce log verbosity, see https://github.com/facebook/docusaurus/pull/5420#issuecomment-906613105
      stats: 'summary',
    },
    static: siteConfig.staticDirectories.map((dir) => ({
      publicPath: baseUrl,
      directory: path.resolve(siteDir, dir),
      watch: {
        // Useful options for our own monorepo using symlinks!
        // See https://github.com/webpack/webpack/issues/11612#issuecomment-879259806
        followSymlinks: true,
        ignored: /node_modules\/(?!@docusaurus)/,
        ...{pollingOptions},
      },
    })),
    ...(httpsConfig && {
      server:
        typeof httpsConfig === 'object'
          ? {
              type: 'https',
              options: httpsConfig,
            }
          : 'https',
    }),
    historyApiFallback: {
      rewrites: [{from: /\/*/, to: baseUrl}],
    },
    allowedHosts: 'all',
    host,
    port,
    setupMiddlewares: (middlewares, devServer) => {
      // This lets us fetch source contents from webpack for the error overlay.
      middlewares.unshift(evalSourceMapMiddleware(devServer));
      return middlewares;
    },
  };

  // Allow plugin authors to customize/override devServer config
  const devServerConfig: WebpackDevServer.Configuration = merge(
    [defaultDevServerConfig, config.devServer].filter(Boolean),
  );

  const devServer = new WebpackDevServer(devServerConfig, compiler);
  devServer.startCallback(() => {
    if (cliOptions.open) {
      openBrowser(openUrl);
    }
  });

  ['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => {
      devServer.stop();
      process.exit();
    });
  });
}
