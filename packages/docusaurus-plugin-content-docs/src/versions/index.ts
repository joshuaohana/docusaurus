/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import {CURRENT_VERSION_NAME} from '../constants';
import {normalizeUrl, posixPath} from '@docusaurus/utils';
import {validateVersionsOptions} from './validation';
import {
  getDocsDirPathLocalized,
  getVersionMetadataPaths,
  readVersionNames,
} from './files';
import type {
  PluginOptions,
  VersionBanner,
  VersionMetadata,
} from '@docusaurus/plugin-content-docs';
import type {LoadContext} from '@docusaurus/types';

export type VersionContext = {
  /** The version name to get banner of. */
  versionName: string;
  /** All versions, ordered from newest to oldest. */
  versionNames: string[];
  lastVersionName: string;
  context: LoadContext;
  options: PluginOptions;
};

function getVersionEditUrls({
  contentPath,
  contentPathLocalized,
  context,
  options,
}: Pick<VersionMetadata, 'contentPath' | 'contentPathLocalized'> & {
  context: LoadContext;
  options: PluginOptions;
}): Pick<VersionMetadata, 'editUrl' | 'editUrlLocalized'> {
  // If the user is using the functional form of editUrl,
  // she has total freedom and we can't compute a "version edit url"
  if (!options.editUrl || typeof options.editUrl === 'function') {
    return {editUrl: undefined, editUrlLocalized: undefined};
  }

  const editDirPath = options.editCurrentVersion ? options.path : contentPath;
  const editDirPathLocalized = options.editCurrentVersion
    ? getDocsDirPathLocalized({
        siteDir: context.siteDir,
        locale: context.i18n.currentLocale,
        versionName: CURRENT_VERSION_NAME,
        pluginId: options.id,
      })
    : contentPathLocalized;

  const versionPathSegment = posixPath(
    path.relative(context.siteDir, path.resolve(context.siteDir, editDirPath)),
  );
  const versionPathSegmentLocalized = posixPath(
    path.relative(
      context.siteDir,
      path.resolve(context.siteDir, editDirPathLocalized),
    ),
  );

  const editUrl = normalizeUrl([options.editUrl, versionPathSegment]);

  const editUrlLocalized = normalizeUrl([
    options.editUrl,
    versionPathSegmentLocalized,
  ]);

  return {editUrl, editUrlLocalized};
}

/**
 * The default version banner depends on the version's relative position to the
 * latest version. More recent ones are "unreleased", and older ones are
 * "unmaintained".
 */
export function getDefaultVersionBanner({
  versionName,
  versionNames,
  lastVersionName,
}: VersionContext): VersionBanner | null {
  // Current version: good, no banner
  if (versionName === lastVersionName) {
    return null;
  }
  // Upcoming versions: unreleased banner
  if (
    versionNames.indexOf(versionName) < versionNames.indexOf(lastVersionName)
  ) {
    return 'unreleased';
  }
  // Older versions: display unmaintained banner
  return 'unmaintained';
}

export function getVersionBanner(
  context: VersionContext,
): VersionMetadata['banner'] {
  const {versionName, options} = context;
  const versionBannerOption = options.versions[versionName]?.banner;
  if (versionBannerOption) {
    return versionBannerOption === 'none' ? null : versionBannerOption;
  }
  return getDefaultVersionBanner(context);
}

export function getVersionBadge({
  versionName,
  versionNames,
  options,
}: VersionContext): VersionMetadata['badge'] {
  // If site is not versioned or only one version is included
  // we don't show the version badge by default
  // See https://github.com/facebook/docusaurus/issues/3362
  const defaultVersionBadge = versionNames.length !== 1;
  return options.versions[versionName]?.badge ?? defaultVersionBadge;
}

function getVersionClassName({
  versionName,
  options,
}: VersionContext): VersionMetadata['className'] {
  const defaultVersionClassName = `docs-version-${versionName}`;
  return options.versions[versionName]?.className ?? defaultVersionClassName;
}

function getVersionLabel({
  versionName,
  options,
}: VersionContext): VersionMetadata['label'] {
  const defaultVersionLabel =
    versionName === CURRENT_VERSION_NAME ? 'Next' : versionName;
  return options.versions[versionName]?.label ?? defaultVersionLabel;
}

function getVersionPathPart({
  versionName,
  options,
  lastVersionName,
}: VersionContext): string {
  function getDefaultVersionPathPart() {
    if (versionName === lastVersionName) {
      return '';
    }
    return versionName === CURRENT_VERSION_NAME ? 'next' : versionName;
  }
  return options.versions[versionName]?.path ?? getDefaultVersionPathPart();
}

async function createVersionMetadata(
  context: VersionContext,
): Promise<VersionMetadata> {
  const {versionName, lastVersionName, options, context: loadContext} = context;
  const {sidebarFilePath, contentPath, contentPathLocalized} =
    await getVersionMetadataPaths(context);
  const versionPathPart = getVersionPathPart(context);

  const routePath = normalizeUrl([
    loadContext.baseUrl,
    options.routeBasePath,
    versionPathPart,
  ]);

  const versionEditUrls = getVersionEditUrls({
    contentPath,
    contentPathLocalized,
    context: loadContext,
    options,
  });

  return {
    versionName,
    label: getVersionLabel(context),
    banner: getVersionBanner(context),
    badge: getVersionBadge(context),
    className: getVersionClassName(context),
    path: routePath,
    tagsPath: normalizeUrl([routePath, options.tagsBasePath]),
    ...versionEditUrls,
    isLast: versionName === lastVersionName,
    routePriority: versionPathPart === '' ? -1 : undefined,
    sidebarFilePath,
    contentPath,
    contentPathLocalized,
  };
}

/**
 * Filter versions according to provided options (i.e. `onlyIncludeVersions`).
 *
 * Note: we preserve the order in which versions are provided; the order of the
 * `onlyIncludeVersions` array does not matter
 */
export function filterVersions(
  versionNamesUnfiltered: string[],
  options: PluginOptions,
): string[] {
  if (options.onlyIncludeVersions) {
    return versionNamesUnfiltered.filter((name) =>
      options.onlyIncludeVersions!.includes(name),
    );
  }
  return versionNamesUnfiltered;
}

function getLastVersionName({
  versionNames,
  options,
}: Pick<VersionContext, 'versionNames' | 'options'>) {
  return (
    options.lastVersion ??
    versionNames.find((name) => name !== CURRENT_VERSION_NAME) ??
    CURRENT_VERSION_NAME
  );
}

export async function readVersionsMetadata({
  context,
  options,
}: {
  context: LoadContext;
  options: PluginOptions;
}): Promise<VersionMetadata[]> {
  const allVersionNames = await readVersionNames(context.siteDir, options);
  validateVersionsOptions(allVersionNames, options);
  const versionNames = filterVersions(allVersionNames, options);
  const lastVersionName = getLastVersionName({versionNames, options});
  const versionsMetadata = await Promise.all(
    versionNames.map((versionName) =>
      createVersionMetadata({
        versionName,
        versionNames,
        lastVersionName,
        context,
        options,
      }),
    ),
  );
  return versionsMetadata;
}
